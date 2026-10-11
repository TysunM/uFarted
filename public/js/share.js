import { toast } from './ui.js';

// Renders a shareable 1080×1350 image of today's tally (made for stories / group chats).
export async function shareCard(stats, appName) {
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 1350;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1080, 1350);
  grad.addColorStop(0, '#7c3aed'); grad.addColorStop(1, '#db2777');
  g.fillStyle = grad; g.fillRect(0, 0, 1080, 1350);
  g.fillStyle = '#fff'; g.textAlign = 'center';
  const font = (px, w = 800) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  g.font = font(54, 700); g.globalAlpha = 0.85;
  g.fillText(new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }), 540, 170);
  g.globalAlpha = 1; g.font = font(84); g.fillText('My gas report', 540, 280);
  const row = (emoji, n, label, y) => {
    g.font = font(150, 400); g.fillText(emoji, 300, y + 40);
    g.font = font(190); g.textAlign = 'left'; g.fillText(String(n), 450, y + 60);
    g.font = font(52, 700); g.fillText(label, 455, y + 130); g.textAlign = 'center';
  };
  row('💨', stats.today.fart, stats.today.fart === 1 ? 'fart today' : 'farts today', 470);
  row('🫧', stats.today.burp, stats.today.burp === 1 ? 'burp today' : 'burps today', 780);
  if (stats.streak > 1) { g.font = font(60, 800); g.fillText(`🔥 ${stats.streak}-day streak`, 540, 1080); }
  g.font = font(46, 700); g.globalAlpha = 0.9;
  g.fillText(`Tracked with ${appName} · ${location.host}`, 540, 1260);

  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const file = new File([blob], `${appName.toLowerCase()}-today.png`, { type: 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `${appName} — today`, text: `My gas report 💨 Tracked with ${appName}` });
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: file.name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Image saved — share it anywhere 📸');
}
