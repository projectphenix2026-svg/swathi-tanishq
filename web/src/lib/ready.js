// Ready-made messages for a jewellery store. Tapping one saves it as a saved message and uses it;
// staff only fill in the offer and the last date. Each customer's own details are added on sending.
const BUTTONS = [{ type: 'quick_reply', text: 'Interested' }, { type: 'quick_reply', text: 'Not now' }];

export const READY_MESSAGES = [
  {
    key: 'diwali', pic: 'diya', title: 'Diwali', when: 'Oct–Nov', codeWord: 'DIWALI',
    offer: '20% off making charges',
    sms: 'Hi {{name}}, Diwali offer at {{store}}: {{offer}} till {{offer_ends}}. Code {{offer_code}}.',
    body: "Hi {{name}},\n\n*Diwali greetings from {{store}}!*\nLight up the festival with our new gold and diamond designs.\n\n*Your offer:* {{offer}}\n*Valid till:* {{offer_ends}}\n*Your code:* {{offer_code}}\n\nShow this code at billing. We look forward to welcoming you.",
  },
  {
    key: 'dhanteras', pic: 'moneybag', title: 'Dhanteras', when: '2 days before Diwali', codeWord: 'DHAN',
    offer: 'no making charges on gold coins',
    sms: 'Hi {{name}}, Dhanteras at {{store}}: {{offer}} till {{offer_ends}}. Code {{offer_code}}.',
    body: "Hi {{name}},\n\n*Dhanteras is the most auspicious day to bring gold home.*\n\n*At {{store}}:* {{offer}}\n*Valid till:* {{offer_ends}}\n*Your code:* {{offer_code}}\n\nTap *Interested* and we will keep your favourite designs ready.",
  },
  {
    key: 'akshaya', pic: 'blossom', title: 'Akshaya Tritiya', when: 'April–May', codeWord: 'AKSHAYA',
    offer: '15% off making charges',
    sms: 'Hi {{name}}, Akshaya Tritiya gold offer at {{store}}: {{offer}} till {{offer_ends}}. Code {{offer_code}}.',
    body: "Hi {{name}},\n\nGold bought on *Akshaya Tritiya* is said to bring lasting prosperity.\n\n*Your offer:* {{offer}}\n*Valid till:* {{offer_ends}}\n*Your code:* {{offer_code}}\n\nBook your gold at {{store}} today.",
  },
  {
    key: 'new', pic: 'sparkles', title: 'New collection', when: 'Any time', codeWord: 'NEW',
    offer: 'a free gift with every purchase',
    sms: 'Hi {{name}}, our new collection is in at {{store}}. {{offer}} till {{offer_ends}}.',
    body: "Hi {{name}},\n\n*Our new collection has arrived!*\nPieces that pair beautifully with your {{last_purchase}}.\n\n*Just for you:* {{offer}}\n*Valid till:* {{offer_ends}}\n\nCome and see them at {{store}}.",
  },
  {
    key: 'rate', pic: 'chartdown', title: 'Gold rate dropped', when: 'When rates fall', codeWord: 'GOLD',
    offer: 'today’s lower rate locked for 3 days',
    sms: 'Hi {{name}}, gold rates are down this week. {{store}}: {{offer}} till {{offer_ends}}. Code {{offer_code}}.',
    body: "Hi {{name}},\n\n*Good news: gold rates have come down this week.*\nA good time to buy the piece you had in mind.\n\n*At {{store}}:* {{offer}}\n*Valid till:* {{offer_ends}}\n*Your code:* {{offer_code}}\n\nTap *Interested* and we will call you.",
  },
  {
    key: 'wedding', pic: 'ring', title: 'Wedding season', when: 'Nov–Feb, Apr–Jun', codeWord: 'BRIDAL',
    offer: '10% off bridal sets',
    sms: 'Hi {{name}}, bridal sets at {{store}}: {{offer}} till {{offer_ends}}. Book a visit.',
    body: "Hi {{name}},\n\n*Planning a wedding in the family?*\nOur bridal sets are here, in gold, diamond and polki.\n\n*Your offer:* {{offer}}\n*Valid till:* {{offer_ends}}\n\nBook a relaxed viewing at {{store}}. Tap *Interested* and we will call you.",
  },
].map((m) => ({ ...m, name: m.title, buttons: BUTTONS }));

// The first, one-paragraph versions. A saved copy still using one is updated to the formatted text.
export const OLD_READY_BODIES = new Set([
  'Hi {{name}}, Diwali greetings from {{store}}! Light up the festival with our new gold and diamond designs. For you: {{offer}}, till {{offer_ends}}. Show your code {{offer_code}} at billing.',
  'Hi {{name}}, Dhanteras is the most auspicious day to bring gold home. At {{store}}: {{offer}}, till {{offer_ends}}. Your code: {{offer_code}}. Tap Interested and we will keep your favourite designs ready.',
  'Hi {{name}}, gold bought on Akshaya Tritiya is said to bring lasting prosperity. Book your gold at {{store}} with {{offer}}, valid till {{offer_ends}}. Your code: {{offer_code}}.',
  'Hi {{name}}, our new collection has arrived, with pieces that pair beautifully with your {{last_purchase}}. Come and see them at {{store}}: {{offer}} till {{offer_ends}}.',
  'Hi {{name}}, good news: gold rates have come down this week, so it is a good time to buy the piece you had in mind. At {{store}}: {{offer}}, till {{offer_ends}}. Your code: {{offer_code}}.',
  'Hi {{name}}, planning a wedding in the family? Our bridal sets are here, in gold, diamond and polki. Book a relaxed viewing at {{store}} and get {{offer}} till {{offer_ends}}.',
]);

/**
 * The same wording without the sales code, for shops that have sales codes switched off:
 * drops the line or sentence that carries {{offer_code}}.
 */
export function withoutCode(text) {
  if (!text || !text.includes('{{offer_code}}')) return text;
  return text
    .replace(/Show this code at billing\. /g, '')
    .split('\n')
    .map((line) => (line.includes('{{offer_code}}') && !/[.!?।](\s|$)/.test(line.replace(/\{\{offer_code\}\}/g, '')) ? null : line))
    .filter((line) => line !== null)
    .join('\n')
    .replace(/\s*[^.!?।\n]*\{\{offer_code\}\}[^.!?।\n-]*[.!?।]?/g, '')
    .replace(/([.!?।])-/g, '$1 -')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Ready-made wishes for Special days (no sales code; birthday and anniversary can carry a gift offer).
export const READY_WISHES = {
  birthday: {
    name: 'Birthday wish', pic: 'cake',
    body: 'Happy birthday, {{name}}!\n\nEveryone at {{store}} wishes you a wonderful year ahead.\n\n*A birthday gift for you:* {{offer}}\n*Valid till:* {{offer_ends}}\n\nWe would love to see you at the store.',
    sms: 'Happy birthday {{name}}! Birthday gift at {{store}}: {{offer}} till {{offer_ends}}.',
    offer: 'a free silver coin with any purchase',
  },
  anniversary: {
    name: 'Anniversary wish', pic: 'ring',
    body: 'Happy anniversary, {{name}}!\n\nWishing you both many more happy years together, from all of us at {{store}}.\n\n*Your anniversary gift:* {{offer}}\n*Valid till:* {{offer_ends}}\n\nWe look forward to seeing you both.',
    sms: 'Happy anniversary {{name}}! Gift at {{store}}: {{offer}} till {{offer_ends}}.',
    offer: '10% off making charges',
  },
  personal: {
    name: 'Family day wish', pic: 'blossom',
    body: 'Hi {{name}},\n\nWishing your family a very happy special day, from all of us at {{store}}.\n\nIf you are planning a gift, we would love to help you choose.',
    sms: 'Hi {{name}}, warm wishes to your family on this special day from {{store}}.',
  },
  festival: {
    name: 'Festival greeting', pic: 'sparkles',
    body: 'Hi {{name}},\n\n*Warm wishes from {{store}}!*\nMay this festival bring joy and prosperity to your home.\n\n*Festive offer:* {{offer}}\n*Valid till:* {{offer_ends}}\n\nVisit us soon.',
    sms: 'Festival wishes from {{store}}, {{name}}! Offer: {{offer}} till {{offer_ends}}.',
    offer: '15% off making charges',
  },
};

// The picture (a real icon, never an emoji) that goes with a template or message name, so lists
// show it next to the wording. Names like "Diwali · 18 Oct" or "Diwali · తెలుగు" still match.
const ICON_BY_NAME = [
  ...READY_MESSAGES.map((m) => [m.title.toLowerCase(), m.pic]),
  ...Object.values(READY_WISHES).map((w) => [w.name.toLowerCase(), w.pic]),
  ['thank you', 'handshake'],
];
export function iconFor(name) {
  const n = String(name || '').trim().toLowerCase();
  return ICON_BY_NAME.find(([key]) => n.startsWith(key))?.[1] || 'memo';
}
