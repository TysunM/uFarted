// Single source of truth for log types, triggers and health reference data.
// Imported by the browser app AND the server (validation), so keep it dependency-free.

export const FART_GROUPS = [
  { label: 'Everyday', types: [
    { id: 'classic', emoji: '💨', name: 'Classic', desc: 'Standard issue. Nothing fancy, just doing its job.' },
    { id: 'toot', emoji: '🎺', name: 'Toot', desc: 'Short, polite, almost musical.' },
    { id: 'double_tap', emoji: '✌️', name: 'Double Tap', desc: 'Two in quick succession. The encore.' },
    { id: 'morning', emoji: '🌅', name: 'Morning Glory', desc: 'First of the day. Often the biggest.' },
  ] },
  { label: 'Loud & proud', types: [
    { id: 'squeaker', emoji: '🐭', name: 'Squeaker', desc: 'High-pitched squeak through tight cheeks.' },
    { id: 'whistler', emoji: '🎶', name: 'Whistler', desc: 'Long, tuneful, surprisingly melodic.' },
    { id: 'thunder', emoji: '⛈️', name: 'Thunderclap', desc: 'Loud, explosive, turns heads.' },
    { id: 'foghorn', emoji: '📯', name: 'Foghorn', desc: 'Deep, loud and long. Ships can hear it.' },
    { id: 'growler', emoji: '🐻', name: 'Growler', desc: 'Low rumble you feel as much as hear.' },
    { id: 'rapid_fire', emoji: '🥁', name: 'Rapid Fire', desc: 'Staccato burst of pops. Drumroll, please.' },
    { id: 'staircase', emoji: '🪜', name: 'Staircase', desc: 'Comes out in steps: one, two, three…' },
  ] },
  { label: 'Stealth', types: [
    { id: 'sbd', emoji: '🤫', name: 'Silent But Deadly', desc: 'No sound. All smell. Plausible deniability.' },
    { id: 'whisper', emoji: '🍃', name: 'Whisper', desc: 'Barely there. Sound and smell both optional.' },
    { id: 'slow_leak', emoji: '🎈', name: 'Slow Leak', desc: 'A long, quiet release over several seconds.' },
    { id: 'squeeze', emoji: '🥴', name: 'Squeeze-Out', desc: 'Tried to hold it in. Lost slowly.' },
    { id: 'fake_out', emoji: '🎭', name: 'Fake-Out', desc: 'Felt huge, came out tiny. Or nothing at all.' },
  ] },
  { label: 'Situational', types: [
    { id: 'crop_duster', emoji: '🚜', name: 'Crop Duster', desc: 'Released while walking. Spreads the love.' },
    { id: 'dutch_oven', emoji: '🛏️', name: 'Dutch Oven', desc: 'Trapped under the covers. Relationships tested.' },
    { id: 'elevator', emoji: '🛗', name: 'Elevator Special', desc: 'Tight space, no escape, witnesses.' },
    { id: 'cushion', emoji: '🛋️', name: 'Cushion Muffler', desc: 'Absorbed by a seat. Muffled bass.' },
    { id: 'echo', emoji: '🚽', name: 'Echo Chamber', desc: 'Toilet-bowl acoustics. Amplified.' },
    { id: 'bubbler', emoji: '🛁', name: 'Bubbler', desc: 'Underwater. Bath or pool. Bubbles don’t lie.' },
    { id: 'workout', emoji: '🏋️', name: 'Workout Pop', desc: 'Mid-squat, mid-yoga, mid-plank. Core engaged.' },
    { id: 'sneeze_combo', emoji: '🤧', name: 'Sneeze Combo', desc: 'A sneeze or cough triggered a bonus.' },
  ] },
  { label: 'Texture', types: [
    { id: 'hot', emoji: '🌶️', name: 'Hot One', desc: 'You felt the heat. Spicy food, maybe?' },
    { id: 'wet', emoji: '💦', name: 'Wet One', desc: 'Sounded moist. Proceed with caution.',
      health: 'Frequent wet ones alongside loose stools for more than a few days is worth mentioning to a doctor.' },
  ] },
];

export const BURP_GROUPS = [
  { label: 'Everyday', types: [
    { id: 'classic', emoji: '🫧', name: 'Classic Burp', desc: 'Clean, honest, gets the job done.' },
    { id: 'baby', emoji: '🍼', name: 'Baby Burp', desc: 'Tiny and polite. Barely escaped.' },
    { id: 'post_meal', emoji: '🍽️', name: 'Post-Meal', desc: 'The meal-complete chime.' },
    { id: 'silent', emoji: '🤐', name: 'Swallowed', desc: 'Kept it in. Mostly.' },
    { id: 'nose', emoji: '👃', name: 'Nose Burp', desc: 'Escaped through the nose. Stealthy.' },
  ] },
  { label: 'Big ones', types: [
    { id: 'belch', emoji: '🦬', name: 'Big Belch', desc: 'Deep, loud, from the depths.' },
    { id: 'soda', emoji: '🥤', name: 'Soda Pop', desc: 'Carbonation’s revenge.' },
    { id: 'rolling', emoji: '🌊', name: 'Rolling Thunder', desc: 'Long, rumbling, multi-stage.' },
    { id: 'talker', emoji: '🔤', name: 'The Talker', desc: 'Long enough to say words. A gift.' },
  ] },
  { label: 'Special', types: [
    { id: 'hiccup', emoji: '😯', name: 'Hiccup Burp', desc: 'A burp and a hiccup had a baby.' },
    { id: 'double_ender', emoji: '🔁', name: 'Double-Ender', desc: 'Burp and fart at the same time. Rare.' },
    { id: 'wet', emoji: '💧', name: 'Wet Burp', desc: 'Brought a little something up.',
      health: 'Regularly bringing up liquid or sour taste can be reflux. Mention it to a doctor if it happens most days.' },
    { id: 'sulfur', emoji: '🥚', name: 'Rotten Egg', desc: 'Sulfur taste or smell.',
      health: 'Frequent sulfur burps with stomach pain or diarrhoea can signal an infection. See a doctor if it persists.' },
  ] },
];

export const KINDS = {
  fart: { id: 'fart', emoji: '💨', name: 'Fart', plural: 'Farts', groups: FART_GROUPS },
  burp: { id: 'burp', emoji: '🫧', name: 'Burp', plural: 'Burps', groups: BURP_GROUPS },
};

const index = {};
for (const k of Object.values(KINDS)) {
  index[k.id] = new Map(k.groups.flatMap((g) => g.types).map((t) => [t.id, t]));
}
export const typeInfo = (kind, type) => index[kind]?.get(type) ?? index[kind]?.get('classic');
export const isValidType = (kind, type) => Boolean(index[kind]?.has(type));

// Common gas triggers (NIDDK / NHS dietary guidance on gas-producing foods and swallowed air).
export const TRIGGERS = [
  { id: 'beans', emoji: '🫘', name: 'Beans & lentils' },
  { id: 'brassica', emoji: '🥦', name: 'Broccoli, cabbage, sprouts' },
  { id: 'onion', emoji: '🧅', name: 'Onion & garlic' },
  { id: 'dairy', emoji: '🥛', name: 'Dairy' },
  { id: 'fizzy', emoji: '🥤', name: 'Fizzy drinks' },
  { id: 'sweetener', emoji: '🍬', name: 'Sugar-free / sweeteners' },
  { id: 'fruit', emoji: '🍎', name: 'Apples, pears, dried fruit' },
  { id: 'fiber', emoji: '🌾', name: 'High fibre / whole grains' },
  { id: 'fatty', emoji: '🍟', name: 'Fatty or fried food' },
  { id: 'spicy', emoji: '🌶️', name: 'Spicy food' },
  { id: 'protein', emoji: '💪', name: 'Protein shake / bar' },
  { id: 'alcohol', emoji: '🍺', name: 'Beer / alcohol' },
  { id: 'coffee', emoji: '☕', name: 'Coffee' },
  { id: 'air', emoji: '🌬️', name: 'Gum, straws, eating fast' },
  { id: 'big_meal', emoji: '🍽️', name: 'Big meal' },
  { id: 'stress', emoji: '😬', name: 'Stress' },
  { id: 'meds', emoji: '💊', name: 'New meds / supplement' },
];
export const TRIGGER_IDS = new Set(TRIGGERS.map((t) => t.id));

export const SMELL = ['😇 None', '🙂 Faint', '😐 Noticeable', '🤢 Strong', '☠️ Toxic'];
export const DISCOMFORT = ['None', 'Mild', 'Moderate', 'Severe'];
// Daily gut check scales (0–3).
export const BLOATING = ['😌 Flat', '🙂 A little', '😣 Bloated', '🎈 Balloon'];
export const PAIN = ['😊 None', '😐 Mild', '😖 Moderate', '😫 Severe'];

export const REACTIONS = [
  { id: 'laugh', emoji: '😂' },
  { id: 'fire', emoji: '🔥' },
  { id: 'gross', emoji: '🤢' },
  { id: 'clap', emoji: '👏' },
  { id: 'trophy', emoji: '🏆' },
];
export const REACTION_IDS = new Set(REACTIONS.map((r) => r.id));
export const REPORT_REASONS = [
  { id: 'not_gas', name: 'Not a fart or burp' },
  { id: 'offensive', name: 'Offensive speech or content' },
  { id: 'spam', name: 'Spam' },
  { id: 'other', name: 'Something else' },
];

// Reference ranges. Population numbers are context only; the app compares you to your own baseline.
export const HEALTH = {
  fart: {
    low: 2, high: 7,
    summary: 'Most people log 2–7 a day (median ~4).',
    detail: 'In a 2026 CSIRO study, 6,416 Australians logged 360,192 farts in an app: the average was 5 a day, '
      + 'the median 3.8, and 80% of people logged 2–7. Activity peaks 6–10 pm. A small 2026 University of Maryland '
      + 'pilot using wearable sensors detected far more — about 32 a day, ranging 4–59 — because most are silent, '
      + 'unnoticed, or happen while you sleep. There is no daily minimum you need to hit.',
  },
  burp: {
    low: 0, high: 30,
    summary: 'Up to ~30 a day is normal, mostly after meals.',
    detail: 'Belching is how your stomach vents swallowed air, and up to around 30 a day is considered '
      + 'physiological, mostly after meals. Fizzy drinks, gum, straws and eating fast all add more. '
      + 'Burping only becomes a concern when it is bothersome most days or comes with other symptoms.',
  },
  redFlags: [
    'Blood in your poo, or black / tarry stools',
    'Losing weight without trying',
    'Severe or sudden stomach pain',
    'Bloating that won’t go away, or diarrhoea / constipation that won’t settle',
    'Trouble swallowing, persistent vomiting or heartburn',
    'Chest pain with burping — get urgent help',
  ],
  sources: [
    { name: 'JAMA Network Open (2026) — Regular Flatulence Patterns Among Community-Dwelling Individuals in Australia', url: 'https://doi.org/10.1001/jamanetworkopen.2026.15637' },
    { name: 'University of Maryland (2026) — Smart underwear measures human flatulence', url: 'https://today.umd.edu/umd-scientists-create-smart-underwear-to-measure-human-flatulence' },
    { name: 'NHS — Flatulence', url: 'https://www.nhs.uk/symptoms/flatulence' },
    { name: 'Frontline Gastroenterology — review of belching (physiological ~30/day)', url: 'https://fg.bmj.com/content/17/5/440' },
  ],
};

export const BADGES = [
  { id: 'first', emoji: '🐣', name: 'First Toot', desc: 'Logged your first one.' },
  { id: 'streak7', emoji: '🔥', name: 'On a Roll', desc: '7-day logging streak.' },
  { id: 'streak30', emoji: '🏅', name: 'Gas Master', desc: '30-day logging streak.' },
  { id: 'century', emoji: '💯', name: 'Century Club', desc: '100 total logs.' },
  { id: 'symphony', emoji: '🎼', name: 'Symphony', desc: '5 different types in one day.' },
  { id: 'recorder', emoji: '🎙️', name: 'Sound Engineer', desc: 'Recorded your first clip.' },
  { id: 'night_owl', emoji: '🦉', name: 'Night Owl', desc: 'Logged one between midnight and 4 am.' },
  { id: 'bilingual', emoji: '↕️', name: 'Both Ends', desc: 'Logged a fart and a burp in the same day.' },
  { id: 'gut_feeling', emoji: '🩺', name: 'Gut Feeling', desc: '7 daily gut checks.' },
];
