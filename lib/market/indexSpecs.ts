/**
 * Client-side mirror of server.ts's INDEX_SYMBOLS (Markets > Indices, /api/indices). Same reason
 * commoditySpecs.ts exists as its own file rather than importing server.ts: server.ts is a Node
 * backend bundled separately (esbuild -> dist/server.cjs), not part of the Vite frontend build,
 * so anything the client needs statically (asset universe search/watchlist) has to be duplicated
 * here rather than imported. Keep this list identical to server.ts's INDEX_SYMBOLS - it is not a
 * new provider, just the same 10 symbols already live in production surfaced to search/watchlist.
 */

export interface IndexSpec {
  symbol: string;
  name: string;
  region: 'US' | 'EU' | 'UK' | 'JP';
}

export const INDEX_SPECS: IndexSpec[] = [
  { symbol: '^GSPC', name: 'S&P 500', region: 'US' },
  { symbol: '^IXIC', name: 'Nasdaq Composite', region: 'US' },
  { symbol: '^DJI', name: 'Dow Jones Industrial Average', region: 'US' },
  { symbol: '^RUT', name: 'Russell 2000', region: 'US' },
  { symbol: '^VIX', name: 'CBOE Volatility Index', region: 'US' },
  { symbol: 'DX-Y.NYB', name: 'US Dollar Index (DXY)', region: 'US' },
  { symbol: '^N225', name: 'Nikkei 225', region: 'JP' },
  { symbol: '^GDAXI', name: 'DAX', region: 'EU' },
  { symbol: '^FTSE', name: 'FTSE 100', region: 'UK' },
  { symbol: '^STOXX50E', name: 'Euro Stoxx 50', region: 'EU' },
];
