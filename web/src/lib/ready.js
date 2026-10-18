// Ready-made messages for a jewellery store. Tapping one saves it as a saved message and uses it;
// staff only fill in the offer and the last date. Each customer's own details are added on sending.
const BUTTONS = [{ type: 'quick_reply', text: 'Interested' }, { type: 'quick_reply', text: 'Not now' }];

export const READY_MESSAGES = [
  {
    key: 'diwali', emoji: '🪔', pic: 'diya', title: 'Diwali', when: 'Oct–Nov', codeWord: 'DIWALI',
    offer: '20% off making charges',
    body: 'Hi {{name}}, Diwali greetings from {{store}}! Light up the festival with our new gold and diamond designs. For you: {{offer}}, till {{offer_ends}}. Show your code {{offer_code}} at billing.',
  },
  {
    key: 'dhanteras', emoji: '💰', pic: 'moneybag', title: 'Dhanteras', when: '2 days before Diwali', codeWord: 'DHAN',
    offer: 'no making charges on gold coins',
    body: 'Hi {{name}}, Dhanteras is the most auspicious day to bring gold home. At {{store}}: {{offer}}, till {{offer_ends}}. Your code: {{offer_code}}. Tap Interested and we will keep your favourite designs ready.',
  },
  {
    key: 'akshaya', emoji: '🌼', pic: 'blossom', title: 'Akshaya Tritiya', when: 'April–May', codeWord: 'AKSHAYA',
    offer: '15% off making charges',
    body: 'Hi {{name}}, gold bought on Akshaya Tritiya is said to bring lasting prosperity. Book your gold at {{store}} with {{offer}}, valid till {{offer_ends}}. Your code: {{offer_code}}.',
  },
  {
    key: 'new', emoji: '✨', pic: 'sparkles', title: 'New collection', when: 'Any time', codeWord: 'NEW',
    offer: 'a free gift with every purchase',
    body: 'Hi {{name}}, our new collection has arrived, with pieces that pair beautifully with your {{last_purchase}}. Come and see them at {{store}}: {{offer}} till {{offer_ends}}.',
  },
  {
    key: 'rate', emoji: '📉', pic: 'chartdown', title: 'Gold rate dropped', when: 'When rates fall', codeWord: 'GOLD',
    offer: 'today’s lower rate locked for 3 days',
    body: 'Hi {{name}}, good news: gold rates have come down this week, so it is a good time to buy the piece you had in mind. At {{store}}: {{offer}}, till {{offer_ends}}. Your code: {{offer_code}}.',
  },
  {
    key: 'wedding', emoji: '💍', pic: 'ring', title: 'Wedding season', when: 'Nov–Feb, Apr–Jun', codeWord: 'BRIDAL',
    offer: '10% off bridal sets',
    body: 'Hi {{name}}, planning a wedding in the family? Our bridal sets are here, in gold, diamond and polki. Book a relaxed viewing at {{store}} and get {{offer}} till {{offer_ends}}.',
  },
].map((m) => ({ ...m, name: `${m.emoji} ${m.title}`, buttons: BUTTONS }));
