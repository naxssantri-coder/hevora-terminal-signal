// Standalone sanity check for src/components/chart/drawingMath.ts (drawing-tools framework,
// built on a separate branch - not wired into the production chart yet). Pure geometry, testable
// directly with tsx, no browser needed.

import {
  distanceToSegment, distanceToRay, distanceToHorizontalLine, isNearRectangle, fibLevelPrice, pctChange,
  distanceToLine, distanceToVerticalLine, isNearEllipseBorder, distanceToTriangleBorder, distanceToPolyline,
} from '../src/components/chart/drawingMath';

let failures = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (!cond) { failures++; console.log(`FAIL: ${name}${detail ? ' - ' + detail : ''}`); }
  else console.log(`ok:   ${name}`);
}
function closeTo(a: number, b: number, eps = 1e-9) { return Math.abs(a - b) < eps; }

// --- distanceToSegment ---
assert('point exactly on a horizontal segment -> distance 0', closeTo(distanceToSegment({ x: 50, y: 10 }, { x: 0, y: 10 }, { x: 100, y: 10 }), 0));
assert('point directly above segment midpoint -> perpendicular distance', closeTo(distanceToSegment({ x: 50, y: 20 }, { x: 0, y: 10 }, { x: 100, y: 10 }), 10));
assert('point beyond segment end -> distance to nearest ENDPOINT, not the infinite line', closeTo(distanceToSegment({ x: 150, y: 10 }, { x: 0, y: 10 }, { x: 100, y: 10 }), 50));
assert('point beyond segment start -> distance to that endpoint', closeTo(distanceToSegment({ x: -50, y: 10 }, { x: 0, y: 10 }, { x: 100, y: 10 }), 50));
assert('degenerate segment (a===b) -> plain point distance', closeTo(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 }), 5));

// --- distanceToRay (bounded only at the start, infinite past the end) ---
assert('ray: point beyond the far end still measures the perpendicular distance (not clamped)', closeTo(distanceToRay({ x: 200, y: 20 }, { x: 0, y: 10 }, { x: 100, y: 10 }), 10));
assert('ray: point before the start clamps to the start point', closeTo(distanceToRay({ x: -50, y: 10 }, { x: 0, y: 10 }, { x: 100, y: 10 }), 50));

// --- distanceToHorizontalLine ---
assert('horizontal line: only vertical distance matters, x ignored', distanceToHorizontalLine({ x: 99999, y: 45 }, 40) === 5);
assert('horizontal line: point exactly on the row -> 0', distanceToHorizontalLine({ x: 0, y: 40 }, 40) === 0);

// --- isNearRectangle ---
const rectA = { x: 10, y: 10 };
const rectB = { x: 110, y: 60 };
assert('rectangle: point near the top border (inside tolerance) is a hit', isNearRectangle({ x: 50, y: 11 }, rectA, rectB, 4));
assert('rectangle: point deep in the CENTER is NOT a hit (only borders select)', !isNearRectangle({ x: 60, y: 35 }, rectA, rectB, 4));
assert('rectangle: point well outside the box is NOT a hit', !isNearRectangle({ x: 500, y: 500 }, rectA, rectB, 4));
assert('rectangle: corners are swap-order-independent (b,a same as a,b)', isNearRectangle({ x: 50, y: 11 }, rectB, rectA, 4));

// --- fibLevelPrice ---
// Standard convention: swing drawn from 4500 (point A) down to 4400 (point B) - ratio 0 sits at B
// (4400, the more recent/second point), ratio 1 sits at A (4500).
assert('fib 0.0 sits at point B exactly', fibLevelPrice(4500, 4400, 0) === 4400);
assert('fib 1.0 sits at point A exactly', fibLevelPrice(4500, 4400, 1) === 4500);
assert('fib 0.5 sits at the exact midpoint', fibLevelPrice(4500, 4400, 0.5) === 4450);
assert('fib 0.618 (golden ratio) lands where expected', closeTo(fibLevelPrice(4500, 4400, 0.618), 4461.8));
// Reversed swing (B > A) - the SAME ratio convention should still hold with A/B swapped roles.
assert('fib direction-independent: reversed swing still puts 0 at B, 1 at A', fibLevelPrice(4400, 4500, 0) === 4500 && fibLevelPrice(4400, 4500, 1) === 4400);

// --- pctChange ---
assert('pctChange up move', closeTo(pctChange(100, 110), 10));
assert('pctChange down move', closeTo(pctChange(100, 90), -10));
assert('pctChange from zero does not divide by zero / NaN', pctChange(0, 50) === 0);

// --- distanceToLine (infinite BOTH directions, unlike distanceToRay) ---
assert('line: point beyond either end still measures perpendicular distance', closeTo(distanceToLine({ x: -200, y: 20 }, { x: 0, y: 10 }, { x: 100, y: 10 }), 10));
assert('line: point beyond the OTHER end (past b) also not clamped', closeTo(distanceToLine({ x: 300, y: 20 }, { x: 0, y: 10 }, { x: 100, y: 10 }), 10));
assert('line: on the line -> 0', distanceToLine({ x: 50, y: 10 }, { x: 0, y: 10 }, { x: 100, y: 10 }) === 0);

// --- distanceToVerticalLine ---
assert('vertical line: only horizontal distance matters, y ignored', distanceToVerticalLine({ x: 45, y: 99999 }, 40) === 5);

// --- isNearEllipseBorder ---
const ellA = { x: 0, y: 0 }, ellB = { x: 100, y: 50 }; // center (50,25), rx=50, ry=25
assert('ellipse: point on the border (rightmost edge) is a hit', isNearEllipseBorder({ x: 100, y: 25 }, ellA, ellB, 2));
assert('ellipse: point at dead center is NOT a hit (only border selects)', !isNearEllipseBorder({ x: 50, y: 25 }, ellA, ellB, 2));
assert('ellipse: point far outside is NOT a hit', !isNearEllipseBorder({ x: 500, y: 500 }, ellA, ellB, 2));
// A circle is just an ellipse with rx===ry - same function, sanity-check a true circle case too.
const circA = { x: 0, y: 0 }, circB = { x: 100, y: 100 }; // center (50,50), r=50
assert('circle (equal rx/ry): top-of-circle point is a hit', isNearEllipseBorder({ x: 50, y: 0 }, circA, circB, 2));

// --- distanceToTriangleBorder ---
const triA = { x: 0, y: 0 }, triB = { x: 100, y: 0 }, triC = { x: 50, y: 100 };
assert('triangle: point on the base edge -> 0', distanceToTriangleBorder({ x: 50, y: 0 }, triA, triB, triC) === 0);
assert('triangle: point at the centroid is far from every edge (not a hit at a small tolerance)', distanceToTriangleBorder({ x: 50, y: 33 }, triA, triB, triC) > 5);

// --- distanceToPolyline ---
const poly = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }];
assert('polyline: point on the first segment -> 0', distanceToPolyline({ x: 25, y: 0 }, poly) === 0);
assert('polyline: point on the second segment -> 0', distanceToPolyline({ x: 50, y: 25 }, poly) === 0);
assert('polyline: point off both segments measures the nearer one', closeTo(distanceToPolyline({ x: 25, y: 10 }, poly), 10));
assert('polyline: single-point path measures plain point distance', distanceToPolyline({ x: 3, y: 4 }, [{ x: 0, y: 0 }]) === 5);
assert('polyline: empty path -> Infinity (never a false hit)', distanceToPolyline({ x: 0, y: 0 }, []) === Infinity);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
