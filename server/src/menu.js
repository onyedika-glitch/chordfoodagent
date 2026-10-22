// Mama Tee's Kitchen: menu, delivery zones and opening hours.
// This file is the price source of truth. The agent never computes totals itself;
// the server prices every order from here, so a model mistake can't undercharge.
// All amounts are in kobo (1 naira = 100 kobo), which is what Paystack expects.

export const BUSINESS = {
  name: "Mama Tee's Kitchen",
  city: 'Lagos',
  kitchen: '14 Herbert Macaulay Way, Yaba (pickup point)',
  timezone: 'Africa/Lagos',
  opens: '10:00',
  lastOrder: '20:30',
  minOrderKobo: 300000,
};

export const MENU = [
  { id: 'jollof-chicken', name: 'Jollof rice + fried chicken', priceKobo: 450000, category: 'mains' },
  { id: 'fried-rice-turkey', name: 'Fried rice + peppered turkey', priceKobo: 550000, category: 'mains' },
  { id: 'ofada-ayamase', name: 'Ofada rice + ayamase sauce', priceKobo: 480000, category: 'mains' },
  { id: 'amala-abula', name: 'Amala + gbegiri + ewedu + assorted meat', priceKobo: 400000, category: 'mains' },
  { id: 'poundo-egusi', name: 'Pounded yam + egusi + goat meat', priceKobo: 500000, category: 'mains' },
  { id: 'small-chops', name: 'Small chops (10 pieces)', priceKobo: 350000, category: 'sides' },
  { id: 'moi-moi', name: 'Moi moi (1 wrap)', priceKobo: 80000, category: 'sides' },
  { id: 'dodo', name: 'Dodo (fried plantain), 1 portion', priceKobo: 70000, category: 'sides' },
  { id: 'zobo', name: 'Zobo 50cl', priceKobo: 70000, category: 'drinks' },
  { id: 'chapman', name: 'Chapman 50cl', priceKobo: 150000, category: 'drinks' },
];

// Toggled by the owner when something runs out. Comma-separated ids in SOLD_OUT override this.
export const DEFAULT_SOLD_OUT = ['poundo-egusi'];

export const ZONES = [
  { id: 'pickup', name: 'Pickup at the kitchen (Yaba)', feeKobo: 0, eta: '20-30 min' },
  { id: 'yaba-surulere', name: 'Yaba, Surulere, Ebute Metta', feeKobo: 150000, eta: '35-50 min' },
  { id: 'ikeja', name: 'Ikeja, Maryland, Ogba', feeKobo: 200000, eta: '50-70 min' },
  { id: 'island', name: 'Victoria Island, Ikoyi, Lekki Phase 1', feeKobo: 250000, eta: '60-80 min' },
  { id: 'ajah', name: 'Ajah, Sangotedo', feeKobo: 300000, eta: '80-100 min' },
];

export function soldOut() {
  const env = process.env.SOLD_OUT;
  if (env === undefined) return new Set(DEFAULT_SOLD_OUT);
  return new Set(env.split(',').map((s) => s.trim()).filter(Boolean));
}

export const naira = (kobo) => `₦${(kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

// Is the kitchen taking orders right now? Ignored when ALWAYS_OPEN=1 (demo/review).
export function isOpen(now = new Date()) {
  if (process.env.ALWAYS_OPEN === '1') return true;
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS.timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now);
  return hhmm >= BUSINESS.opens && hhmm <= BUSINESS.lastOrder;
}
