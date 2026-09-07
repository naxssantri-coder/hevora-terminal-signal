//+------------------------------------------------------------------+
//|                                             HevoraAutoTrade.mq5  |
//|                  HEVORA Auto Trading Bridge - MT5 Expert Advisor |
//|                                                                    |
//| Polls the HEVORA admin API for signal-lifecycle events (OPEN /    |
//| TP1_HIT / CLOSE_TP2 / CLOSE_SL / CLOSE_INVALIDATED) and executes  |
//| or simulates them on whatever MT5 account this EA is attached to. |
//|                                                                    |
//| IMPORTANT: this EA never reads, stores, or transmits any broker   |
//| login/password. It runs inside a terminal session the admin has   |
//| already logged into manually, exactly like any other EA. The only |
//| secret it holds is the HevoraBridgeKey input, which authenticates |
//| to the HEVORA feed/ack/report API - not to the broker.            |
//+------------------------------------------------------------------+
#property copyright "HEVORA"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>

//--- Inputs (set via the EA's Properties dialog when attached to a chart)
input string HevoraApiBaseUrl    = "https://your-hevora-domain.com"; // Base URL of the HEVORA site
input string HevoraBridgeKey     = "";                                // Bridge API Key from Admin > Auto Trading
input int    PollIntervalSeconds = 5;                                  // Seconds between feed polls

//--- Constants
#define HEVORA_MAGIC_NUMBER   560700251
#define HEVORA_HTTP_TIMEOUT_MS 8000

CTrade   trade;
string   g_apiBase = "";
bool     g_algoDisabledAlertShown = false;

//+------------------------------------------------------------------+
//| Minimal hand-rolled JSON reader                                    |
//|                                                                    |
//| The HEVORA feed only ever emits flat objects (string/number/bool   |
//| values, no nesting) inside a top-level "events" array, so a full   |
//| general-purpose JSON library is unnecessary - these few string     |
//| scanners are enough to read every field this EA needs.             |
//+------------------------------------------------------------------+
string JsonGetRaw(const string &json, const string &key)
{
   string needle = "\"" + key + "\":";
   int pos = StringFind(json, needle);
   if(pos < 0) return "";
   pos += StringLen(needle);
   int len = StringLen(json);
   while(pos < len && StringGetCharacter(json, pos) == ' ') pos++;
   if(pos >= len) return "";

   ushort c = StringGetCharacter(json, pos);
   if(c == '"')
   {
      int start = pos + 1;
      int end = start;
      while(end < len)
      {
         ushort ch = StringGetCharacter(json, end);
         if(ch == '\\') { end += 2; continue; }
         if(ch == '"') break;
         end++;
      }
      return StringSubstr(json, start, end - start);
   }

   int end = pos;
   while(end < len)
   {
      ushort ch = StringGetCharacter(json, end);
      if(ch == ',' || ch == '}' || ch == ']') break;
      end++;
   }
   string raw = StringSubstr(json, pos, end - pos);
   StringTrimLeft(raw);
   StringTrimRight(raw);
   return raw;
}

string JsonGetString(const string &json, const string &key) { return JsonGetRaw(json, key); }
double JsonGetDouble(const string &json, const string &key) { return StringToDouble(JsonGetRaw(json, key)); }
long   JsonGetLong(const string &json, const string &key)   { return StringToInteger(JsonGetRaw(json, key)); }

// Splits the inner content of a JSON array of flat objects (no nested arrays/objects inside each
// element) into one string per top-level {...} object.
int JsonSplitArrayObjects(const string &arrayInner, string &outArr[])
{
   int len = StringLen(arrayInner);
   int depth = 0;
   int start = -1;
   int count = 0;
   bool inString = false;
   ArrayResize(outArr, 0);

   for(int i = 0; i < len; i++)
   {
      ushort ch = StringGetCharacter(arrayInner, i);
      if(inString)
      {
         if(ch == '\\') { i++; continue; }
         if(ch == '"') inString = false;
         continue;
      }
      if(ch == '"') { inString = true; continue; }
      if(ch == '{')
      {
         if(depth == 0) start = i;
         depth++;
      }
      else if(ch == '}')
      {
         depth--;
         if(depth == 0 && start >= 0)
         {
            count++;
            ArrayResize(outArr, count);
            outArr[count - 1] = StringSubstr(arrayInner, start, i - start + 1);
            start = -1;
         }
      }
   }
   return count;
}

// Finds "events":[ ... ] and returns the raw content between the brackets.
string ExtractEventsArrayInner(const string &json)
{
   string needle = "\"events\":[";
   int pos = StringFind(json, needle);
   if(pos < 0) return "";
   pos += StringLen(needle);

   int len = StringLen(json);
   int depth = 1;
   bool inString = false;
   int i = pos;
   for(; i < len; i++)
   {
      ushort ch = StringGetCharacter(json, i);
      if(inString)
      {
         if(ch == '\\') { i++; continue; }
         if(ch == '"') inString = false;
         continue;
      }
      if(ch == '"') { inString = true; continue; }
      if(ch == '[') depth++;
      else if(ch == ']')
      {
         depth--;
         if(depth == 0) break;
      }
   }
   return StringSubstr(json, pos, i - pos);
}

string JsonEscape(const string text)
{
   string result = text;
   StringReplace(result, "\\", "\\\\");
   StringReplace(result, "\"", "\\\"");
   StringReplace(result, "\n", " ");
   StringReplace(result, "\r", " ");
   return result;
}

//+------------------------------------------------------------------+
//| HTTP helpers                                                        |
//+------------------------------------------------------------------+
int StringToUtf8Bytes(const string text, uchar &arr[])
{
   int written = StringToCharArray(text, arr, 0, WHOLE_ARRAY, CP_UTF8);
   // StringToCharArray appends a trailing null terminator - trim it so the HTTP body sent to the
   // server does not carry an extra \0 byte after the closing brace.
   if(written > 0) ArrayResize(arr, written - 1);
   return written;
}

bool PostJson(const string path, const string jsonBody)
{
   string headers = "Content-Type: application/json\r\nX-Bridge-Key: " + HevoraBridgeKey + "\r\n";
   uchar postData[];
   StringToUtf8Bytes(jsonBody, postData);
   uchar result[];
   string resultHeaders;

   string url = g_apiBase + path;
   ResetLastError();
   int status = WebRequest("POST", url, headers, HEVORA_HTTP_TIMEOUT_MS, postData, result, resultHeaders);

   if(status == -1)
   {
      int err = GetLastError();
      if(err == 4060)
         Alert("HEVORA Auto Trade: WebRequest diblokir untuk ", url, ". Buka Tools > Options > Expert Advisors, centang 'Allow WebRequest for listed URL', lalu tambahkan domain HEVORA.");
      else
         Print("HEVORA Auto Trade: POST ", path, " gagal (error ", err, "). Akan dicoba lagi.");
      return false;
   }
   if(status != 200)
   {
      Print("HEVORA Auto Trade: POST ", path, " HTTP status ", status, ". Cek Bridge API Key.");
      return false;
   }
   return true;
}

void ReportEvent(const string eventId, bool success, long ticket, const string message)
{
   string body = "{\"eventId\":\"" + eventId + "\",\"status\":\"" + (success ? "success" : "failed") + "\"";
   if(ticket > 0) body += ",\"ticket\":" + IntegerToString(ticket);
   body += ",\"message\":\"" + JsonEscape(message) + "\"";
   body += ",\"accountBalance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2);
   body += ",\"accountEquity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2);
   body += "}";
   PostJson("/api/admin/autotrade/report", body);
}

void AckEvent(const string eventId)
{
   string body = "{\"eventId\":\"" + eventId + "\"}";
   PostJson("/api/admin/autotrade/ack", body);
}

//+------------------------------------------------------------------+
//| Position helpers - positions are matched to a HEVORA signal via   |
//| the order comment (set to the signalId at OPEN time), scoped by   |
//| this EA's own magic number so it never touches manually-opened or |
//| other EAs' positions.                                              |
//+------------------------------------------------------------------+
int CountOpenHevoraPositions()
{
   int total = 0;
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) == HEVORA_MAGIC_NUMBER) total++;
   }
   return total;
}

bool FindPositionBySignalId(const string signalId, ulong &outTicket)
{
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) != HEVORA_MAGIC_NUMBER) continue;
      if(PositionGetString(POSITION_COMMENT) == signalId)
      {
         outTicket = ticket;
         return true;
      }
   }
   return false;
}

bool IsAlgoTradingAllowed()
{
   return (TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) != 0) && (MQLInfoInteger(MQL_TRADE_ALLOWED) != 0);
}

//+------------------------------------------------------------------+
//| Detects whether the currently logged-in account is a "Cent"      |
//| account rather than a standard/Dollar account, purely for a       |
//| transparent log line - see the ComputeVolume comment below for    |
//| why the risk% formula itself needs no manual adjustment for this. |
//| No major ISO fiat currency code ends in "C", so this heuristic    |
//| does not false-positive on ordinary USD/EUR/GBP/... accounts.     |
//+------------------------------------------------------------------+
bool IsCentAccount()
{
   string currency = AccountInfoString(ACCOUNT_CURRENCY);
   int len = StringLen(currency);
   if(len == 0) return false;

   string upper = currency;
   StringToUpper(upper);
   if(StringFind(upper, "CENT") >= 0) return true;

   ushort lastChar = StringGetCharacter(upper, len - 1);
   return (lastChar == 'C');
}

//+------------------------------------------------------------------+
//| Lot sizing - "fixed" uses lotValue directly and is always         |
//| available regardless of account type (the safest choice when an   |
//| admin wants a guaranteed lot size). "risk_percent" is computed     |
//| HERE, live, from THIS account's own equity and THIS symbol's own   |
//| tick value/size - both only known inside MT5, never on the HEVORA  |
//| server.                                                             |
//|                                                                      |
//| This formula is already generic across Dollar/Standard accounts    |
//| AND Cent accounts (or any other deposit-currency convention a       |
//| broker uses) with no special-casing needed: AccountInfoDouble       |
//| (ACCOUNT_EQUITY) and SymbolInfoDouble(..., SYMBOL_TRADE_TICK_VALUE) |
//| are BOTH always expressed by MT5 in this same account's own        |
//| deposit currency, whatever that currency is - so risk% of equity   |
//| divided by loss-per-lot (in that same currency) is correct without |
//| any manual cent/dollar scaling. IsCentAccount() is used purely to   |
//| log which account type was detected, so the admin can confirm in   |
//| the Experts log that this ran against the account they expected,   |
//| never to change the arithmetic itself.                              |
//+------------------------------------------------------------------+
double ComputeVolume(const string symbol, const string lotMode, double lotValue, double stopLoss)
{
   double volume;

   if(lotMode == "risk_percent")
   {
      bool isCent = IsCentAccount();
      Print("HEVORA Auto Trade: Akun terdeteksi -> currency=", AccountInfoString(ACCOUNT_CURRENCY),
            isCent ? " (Cent account)" : " (Standard/Dollar account)",
            " - lot risk% dihitung otomatis dari equity & tick value akun ini, tidak perlu setting manual jenis akun.");

      double equity = AccountInfoDouble(ACCOUNT_EQUITY);
      double riskAmount = equity * (lotValue / 100.0);
      double price = SymbolInfoDouble(symbol, SYMBOL_BID);
      if(price <= 0) price = SymbolInfoDouble(symbol, SYMBOL_ASK);
      double slDistance = MathAbs(price - stopLoss);
      double tickSize = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
      double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);

      if(slDistance <= 0 || tickSize <= 0 || tickValue <= 0)
      {
         Print("HEVORA Auto Trade: Data simbol/harga tidak lengkap untuk hitung risk% pada ", symbol, " - fallback ke volume minimum.");
         volume = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
      }
      else
      {
         double ticks = slDistance / tickSize;
         double lossPerLot = ticks * tickValue;
         volume = riskAmount / lossPerLot;
      }
   }
   else
   {
      volume = lotValue;
   }

   // Only the broker's OWN tradable volume bounds are applied here (min/max/step) - the admin's
   // Max Lot safety cap is intentionally NOT clamped to here. HandleOpen rejects the order outright
   // when the computed volume exceeds Max Lot instead of silently shrinking it, so an unexpectedly
   // large risk% calculation (wrong stopLoss, misconfigured symbol, etc.) surfaces as a visible
   // failure in the execution log rather than a quietly downsized position.
   double volMin  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double volMax  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double volStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   if(volStep > 0) volume = MathFloor(volume / volStep) * volStep;
   if(volume < volMin) volume = volMin;
   if(volMax > 0 && volume > volMax) volume = volMax;

   return NormalizeDouble(volume, 2);
}

//+------------------------------------------------------------------+
//| Event handlers - each returns false with a sentinel message       |
//| ("LIMIT_REACHED" / "ALGO_DISABLED") when the event should be left |
//| unconsumed for a later retry, or a real success/failure message   |
//| otherwise (which IS ack'd - there is nothing to retry).           |
//+------------------------------------------------------------------+
bool HandleOpen(const string signalId, const string pairId, const string dir, const string brokerSymbol,
                double stopLoss, double takeProfit2, const string lotMode, double lotValue, double maxLot,
                int maxConcurrentTrades, bool isDryRun, long &outTicket, string &outMessage)
{
   outTicket = 0;

   if(StringLen(brokerSymbol) == 0)
   {
      outMessage = "Broker Symbol belum di-mapping untuk pair " + pairId + " di Admin > Auto Trading.";
      Print("HEVORA Auto Trade: ", outMessage);
      return false;
   }

   int openCount = CountOpenHevoraPositions();
   if(openCount >= maxConcurrentTrades)
   {
      outMessage = "LIMIT_REACHED";
      return false;
   }

   if(!SymbolSelect(brokerSymbol, true))
   {
      outMessage = "Symbol " + brokerSymbol + " tidak ditemukan di Market Watch broker ini.";
      Print("HEVORA Auto Trade: ", outMessage);
      return false;
   }

   double volume = ComputeVolume(brokerSymbol, lotMode, lotValue, stopLoss);
   if(volume <= 0)
   {
      outMessage = "Volume terhitung 0 - cek stopLoss dan pengaturan lot/risk untuk pair ini.";
      Print("HEVORA Auto Trade: ", outMessage);
      return false;
   }

   // Hard safety cap, generic across any account/broker type: reject outright rather than silently
   // downsizing when the computed lot (fixed OR risk%) exceeds the admin's Max Lot for this pair.
   if(maxLot > 0 && volume > maxLot)
   {
      outMessage = StringFormat("Lot terhitung %.2f melebihi Max Lot (%.2f) untuk pair ini - order DITOLAK demi keamanan. Sesuaikan Max Lot atau lot/risk%% di Admin > Auto Trading.", volume, maxLot);
      Print("HEVORA Auto Trade: ", outMessage);
      return false;
   }

   if(isDryRun)
   {
      outMessage = StringFormat("[DRY-RUN] Simulasi OPEN %s %s vol=%.2f sl=%.5f tp=%.5f (tidak ada order sungguhan dikirim)",
                                 dir, brokerSymbol, volume, stopLoss, takeProfit2);
      Print("HEVORA Auto Trade: ", outMessage);
      return true;
   }

   if(!IsAlgoTradingAllowed())
   {
      outMessage = "ALGO_DISABLED";
      return false;
   }

   bool sent;
   if(dir == "BUY")
      sent = trade.Buy(volume, brokerSymbol, 0.0, stopLoss, takeProfit2, signalId);
   else
      sent = trade.Sell(volume, brokerSymbol, 0.0, stopLoss, takeProfit2, signalId);

   if(!sent)
   {
      outMessage = StringFormat("order_send gagal: retcode=%d (%s)", trade.ResultRetcode(), trade.ResultRetcodeDescription());
      Print("HEVORA Auto Trade: ", outMessage);
      return false;
   }

   outTicket = (long)trade.ResultOrder();
   outMessage = "Order dibuka.";
   Print("HEVORA Auto Trade: OPEN ", signalId, " -> ticket ", outTicket, " vol=", volume);
   return true;
}

//+------------------------------------------------------------------+
//| Always closes the full remaining position for a signal (used by   |
//| CLOSE_SL/CLOSE_INVALIDATED unconditionally, and by HandleTp1/      |
//| HandleTp2 below when their respective checkbox is enabled). A      |
//| position not found is NOT an error - it just means the position    |
//| was already closed earlier (e.g. TP1 closed it before the TP2      |
//| event arrived), so this is logged and reported as a benign no-op.  |
//+------------------------------------------------------------------+
bool HandleFullClose(const string signalId, bool isDryRun, long &outTicket, string &outMessage)
{
   outTicket = 0;
   ulong ticket;
   if(!FindPositionBySignalId(signalId, ticket))
   {
      outMessage = "Posisi untuk sinyal " + signalId + " tidak ditemukan - kemungkinan sudah ditutup sebelumnya (mis. oleh TP1) atau dry-run. Tidak ada aksi diperlukan.";
      Print("HEVORA Auto Trade: ", outMessage);
      return true;
   }
   outTicket = (long)ticket;

   if(isDryRun)
   {
      outMessage = "[DRY-RUN] Simulasi close penuh ticket " + IntegerToString((long)ticket);
      Print("HEVORA Auto Trade: ", outMessage);
      return true;
   }

   if(!IsAlgoTradingAllowed())
   {
      outMessage = "ALGO_DISABLED";
      return false;
   }

   bool done = trade.PositionClose(ticket);
   if(!done)
   {
      outMessage = StringFormat("PositionClose gagal: retcode=%d (%s)", trade.ResultRetcode(), trade.ResultRetcodeDescription());
      Print("HEVORA Auto Trade: ", outMessage);
      return false;
   }
   outMessage = "Posisi ditutup penuh.";
   Print("HEVORA Auto Trade: CLOSE ", signalId, " -> ticket ", ticket, " ditutup.");
   return true;
}

//+------------------------------------------------------------------+
//| TP1_HIT: full close when tp1CloseEnabled, otherwise log-only.     |
//+------------------------------------------------------------------+
bool HandleTp1(const string signalId, bool tp1CloseEnabled, bool isDryRun, long &outTicket, string &outMessage)
{
   if(!tp1CloseEnabled)
   {
      outTicket = 0;
      ulong ticket;
      if(FindPositionBySignalId(signalId, ticket)) outTicket = (long)ticket;
      outMessage = "TP1 tercapai - checkbox 'Tutup penuh saat TP1' nonaktif, posisi (jika masih ada) dibiarkan berjalan menuju TP2/SL.";
      Print("HEVORA Auto Trade: ", outMessage, " (signal ", signalId, ")");
      return true;
   }

   bool ok = HandleFullClose(signalId, isDryRun, outTicket, outMessage);
   if(ok) Print("HEVORA Auto Trade: TP1_HIT ", signalId, " -> ", outMessage);
   return ok;
}

//+------------------------------------------------------------------+
//| CLOSE_TP2 (the "TP2 hit" event): full close when tp2CloseEnabled, |
//| otherwise log-only. If TP1 already closed the position, that is   |
//| the normal case here and is handled as a no-op by HandleFullClose. |
//+------------------------------------------------------------------+
bool HandleTp2(const string signalId, bool tp2CloseEnabled, bool isDryRun, long &outTicket, string &outMessage)
{
   if(!tp2CloseEnabled)
   {
      outTicket = 0;
      ulong ticket;
      if(FindPositionBySignalId(signalId, ticket)) outTicket = (long)ticket;
      outMessage = "TP2 tercapai - checkbox 'Tutup penuh saat TP2' nonaktif, posisi (jika masih ada) dibiarkan berjalan.";
      Print("HEVORA Auto Trade: ", outMessage, " (signal ", signalId, ")");
      return true;
   }

   bool ok = HandleFullClose(signalId, isDryRun, outTicket, outMessage);
   if(ok) Print("HEVORA Auto Trade: CLOSE_TP2 ", signalId, " -> ", outMessage);
   return ok;
}

//+------------------------------------------------------------------+
//| Dispatch one feed event to the right handler, then report+ack -   |
//| unless the handler signals a transient condition (RETRY sentinel  |
//| messages), in which case the event is deliberately left unconsumed |
//| so the next poll tries it again once the condition clears.        |
//+------------------------------------------------------------------+
void ProcessEvent(const string &ev, const string &mode, int maxConcurrentTrades)
{
   string eventId     = JsonGetString(ev, "eventId");
   string eventType    = JsonGetString(ev, "eventType");
   string signalId     = JsonGetString(ev, "signalId");
   string pairId       = JsonGetString(ev, "pairId");
   string dir          = JsonGetString(ev, "type");
   double stopLoss     = JsonGetDouble(ev, "stopLoss");
   double takeProfit2  = JsonGetDouble(ev, "takeProfit2");
   string brokerSymbol = JsonGetString(ev, "brokerSymbol");
   string lotMode      = JsonGetString(ev, "lotMode");
   double lotValue     = JsonGetDouble(ev, "lotValue");
   double maxLot       = JsonGetDouble(ev, "maxLot");

   bool isDryRun = (mode != "live");
   bool ok;
   long ticket = 0;
   string message = "";

   if(eventType == "OPEN")
   {
      ok = HandleOpen(signalId, pairId, dir, brokerSymbol, stopLoss, takeProfit2, lotMode, lotValue, maxLot,
                       maxConcurrentTrades, isDryRun, ticket, message);
   }
   else if(eventType == "TP1_HIT")
   {
      bool tp1CloseEnabled = (JsonGetString(ev, "tp1CloseEnabled") == "true");
      ok = HandleTp1(signalId, tp1CloseEnabled, isDryRun, ticket, message);
   }
   else if(eventType == "CLOSE_TP2")
   {
      bool tp2CloseEnabled = (JsonGetString(ev, "tp2CloseEnabled") == "true");
      ok = HandleTp2(signalId, tp2CloseEnabled, isDryRun, ticket, message);
   }
   else if(eventType == "CLOSE_SL" || eventType == "CLOSE_INVALIDATED")
   {
      ok = HandleFullClose(signalId, isDryRun, ticket, message);
   }
   else
   {
      Print("HEVORA Auto Trade: eventType tidak dikenal: ", eventType);
      return;
   }

   if(!ok && (message == "LIMIT_REACHED" || message == "ALGO_DISABLED"))
   {
      if(message == "LIMIT_REACHED")
         Print("HEVORA Auto Trade: ", eventType, " ", signalId, " ditunda - maxConcurrentTrades (", maxConcurrentTrades, ") tercapai. Akan dicoba lagi.");
      else if(!g_algoDisabledAlertShown)
      {
         Alert("HEVORA Auto Trade: Algo Trading tidak diizinkan. Centang tombol 'Algo Trading' di toolbar MT5 dan izinkan 'Allow Algo Trading' di tab Common EA ini.");
         g_algoDisabledAlertShown = true;
      }
      return; // Deliberately not ack'd/reported - retried on the next poll.
   }
   g_algoDisabledAlertShown = false;

   ReportEvent(eventId, ok, ticket, message);
   AckEvent(eventId);
}

//+------------------------------------------------------------------+
//| Poll the feed once and dispatch every pending event in order      |
//+------------------------------------------------------------------+
void PollAndProcessFeed()
{
   string headers = "X-Bridge-Key: " + HevoraBridgeKey + "\r\n";
   uchar postData[];
   uchar result[];
   string resultHeaders;

   string url = g_apiBase + "/api/admin/autotrade/feed";
   ResetLastError();
   int status = WebRequest("GET", url, headers, HEVORA_HTTP_TIMEOUT_MS, postData, result, resultHeaders);

   if(status == -1)
   {
      int err = GetLastError();
      if(err == 4060)
         Alert("HEVORA Auto Trade: WebRequest diblokir. Buka Tools > Options > Expert Advisors, centang 'Allow WebRequest for listed URL', lalu tambahkan: ", g_apiBase);
      else
         Print("HEVORA Auto Trade: Gagal mengambil feed (error ", err, "). Akan dicoba lagi di polling berikutnya.");
      return;
   }
   if(status != 200)
   {
      Print("HEVORA Auto Trade: Feed HTTP status ", status, " - cek Bridge API Key dan URL di tab Inputs.");
      return;
   }

   string body = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);

   string mode = JsonGetString(body, "mode");
   if(mode == "") mode = "dry_run";
   long maxConcurrent = JsonGetLong(body, "maxConcurrentTrades");
   if(maxConcurrent <= 0) maxConcurrent = 3;

   string eventsInner = ExtractEventsArrayInner(body);
   if(StringLen(eventsInner) == 0) return;

   string events[];
   int count = JsonSplitArrayObjects(eventsInner, events);
   for(int i = 0; i < count; i++)
      ProcessEvent(events[i], mode, (int)maxConcurrent);
}

//+------------------------------------------------------------------+
//| Expert lifecycle                                                    |
//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(HevoraBridgeKey) == 0)
   {
      Alert("HEVORA Auto Trade: HevoraBridgeKey belum diisi. Salin key dari Admin > Auto Trading > Rotate Bridge API Key, lalu isi di tab Inputs EA ini.");
      return(INIT_PARAMETERS_INCORRECT);
   }
   if(StringLen(HevoraApiBaseUrl) == 0)
   {
      Alert("HEVORA Auto Trade: HevoraApiBaseUrl belum diisi.");
      return(INIT_PARAMETERS_INCORRECT);
   }

   g_apiBase = HevoraApiBaseUrl;
   int urlLen = StringLen(g_apiBase);
   if(urlLen > 0 && StringGetCharacter(g_apiBase, urlLen - 1) == '/')
      g_apiBase = StringSubstr(g_apiBase, 0, urlLen - 1);

   trade.SetExpertMagicNumber(HEVORA_MAGIC_NUMBER);

   int interval = PollIntervalSeconds > 0 ? PollIntervalSeconds : 5;
   EventSetTimer(interval);
   Print("HEVORA Auto Trade EA initialized. Polling ", g_apiBase, " every ", interval, "s. Magic number: ", HEVORA_MAGIC_NUMBER);
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTick()
{
   // Intentionally empty - all work happens in OnTimer() on a fixed poll cadence, not per-tick.
   // This EA never reacts to this chart's own price ticks; it only executes what the HEVORA feed says.
}

void OnTimer()
{
   PollAndProcessFeed();
}
//+------------------------------------------------------------------+
