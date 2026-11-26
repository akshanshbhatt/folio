const fullTurn = 2 * Math.PI;
const floorY = 486;
const cmLabel = value => Number(value.toFixed(1)) + ' cm';

export function rollingDistance(radiusCm, turns) {
  return fullTurn * radiusCm * turns;
}

function segment(ctx, x1, y1, x2, y2, color, width = 3) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function dot(ctx, x, y, radius, color) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, fullTurn);
  ctx.fillStyle = color;
  ctx.fill();
}

function label(ctx, theme, text, x, y, size = 38) {
  ctx.font = '600 ' + size + 'px "' + theme.sans + '"';
  ctx.fillStyle = theme.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function dimension(ctx, theme, start, end, text) {
  const y = floorY + 99;
  segment(ctx, start, y, end, y, theme.second);
  for (const x of [start, end]) segment(ctx, x, y - 13, x, y + 13, theme.second);
  if (text) label(ctx, theme, text, (start + end) / 2, y + 59, 44);
}

function markedWheel(ctx, theme, x, radius, angle) {
  ctx.save();
  ctx.translate(x, floorY - radius);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, fullTurn);
  ctx.fillStyle = theme.paper;
  ctx.fill();
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = 8;
  ctx.stroke();
  for (let spoke = 0; spoke < 6; spoke++) {
    const a = Math.PI / 2 + spoke * fullTurn / 6;
    segment(ctx, 0, 0, Math.cos(a) * (radius - 9), Math.sin(a) * (radius - 9), theme.line, 5);
  }
  dot(ctx, 0, 0, 12, theme.ink);
  dot(ctx, 0, radius, 15, theme.accent);
  ctx.restore();
}

function print(ctx, theme, x) {
  segment(ctx, x, floorY + 8, x, floorY + 36, theme.accent, 9);
}

// The specimen fits one revolution into the same drawing area at any physical radius.
export default function wheel(ctx, {p, params, theme}) {
  const {mode = 'roll', radiusCm = 5} = params;
  if (!Number.isFinite(radiusCm) || radiusCm <= 0) throw Error('wheel.radiusCm must be positive');
  if (!['roll', 'ribbon', 'pinned'].includes(mode)) throw Error('Unknown wheel mode: ' + mode);

  const radius = 99;
  const circumferenceCm = rollingDistance(radiusCm, 1);
  const span = circumferenceCm * (radius / radiusCm);
  const start = mode === 'pinned' ? 500 : (1000 - span) / 2;
  const x = mode === 'pinned' ? start : start + p * span;
  const angle = p * fullTurn;
  ctx.save();
  ctx.lineCap = 'round';
  segment(ctx, 49, floorY, 951, floorY, theme.muted, 3);
  for (let i = 59; i < 950; i += 32) {
    segment(ctx, i, floorY + 5, i - 10, floorY + 19, theme.line, 2);
  }
  print(ctx, theme, start);

  if (mode === 'ribbon') {
    print(ctx, theme, start + span);
    segment(ctx, start, floorY, x, floorY, theme.accent, 10);
    if (p < 1) {
      ctx.beginPath();
      ctx.arc(x, floorY - radius, radius, Math.PI / 2, Math.PI / 2 + fullTurn - angle);
      ctx.lineWidth = 10;
      ctx.strokeStyle = theme.accent;
      ctx.stroke();
    }
    dimension(ctx, theme, start, x, cmLabel(rollingDistance(radiusCm, p)));
    if (p === 1) label(ctx, theme, '2π × ' + cmLabel(radiusCm), 500, floorY - 90);
  } else {
    markedWheel(ctx, theme, x, radius, angle);
    if (mode === 'pinned') {
      const hubY = floorY - radius;
      segment(ctx, x, hubY - 151, x, hubY, theme.second, 8);
      segment(ctx, x - 41, hubY - 151, x + 41, hubY - 151, theme.second, 8);
      dot(ctx, x, hubY, 12, theme.second);
      if (p === 1) dimension(ctx, theme, x, x, '0 cm');
    } else if (p === 1) {
      print(ctx, theme, x);
      dimension(ctx, theme, start, x, '?');
    }
  }
  ctx.restore();
}
