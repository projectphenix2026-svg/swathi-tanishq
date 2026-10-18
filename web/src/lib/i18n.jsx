// Screen language for the everyday screens: English, Telugu, Hindi. Each person's choice is
// remembered on their device. t('English text', { count }) returns the translation (or the
// English text when there is none); {name} placeholders are filled from the second argument.
// Please have a native speaker read these once.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import SCREENS from './i18n-screens.json';
import { translateScreens } from './screen-translate.js';

export const SCREEN_LANGS = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'te', label: 'తెలుగు', short: 'తె' },
  { code: 'hi', label: 'हिन्दी', short: 'हि' },
];

const TE = {
  '{n} went out today': 'ఈ రోజు {count} శుభాకాంక్షలు వెళ్లాయి', 'No birthdays or anniversaries today': 'ఈ రోజు పుట్టినరోజులు, వార్షికోత్సవాలు లేవు',
  'Your “{name}”: {sent} sent, {read} read it': 'మీ “{name}”: {sent} పంపారు, {read} మంది చదివారు',
  'This month {n} bought with their code ({amount}).': 'ఈ నెల {count} మంది తమ కోడ్‌తో కొన్నారు ({amount}).',
  'When a customer buys with their code, it shows here.': 'కస్టమర్ తమ కోడ్‌తో కొంటే, ఇక్కడ కనిపిస్తుంది.',
  'Test mode.': 'టెస్ట్ మోడ్.', 'Nothing is sent to real phones. Messages pretend to be delivered and then read within about a minute, so you can try everything safely.': 'నిజమైన ఫోన్‌లకు ఏదీ పంపబడదు. సందేశాలు ఒక నిమిషంలో చేరినట్లు, చదివినట్లు కనిపిస్తాయి, కాబట్టి అన్నీ భయం లేకుండా ప్రయత్నించవచ్చు.',
  'To send real messages, the owner connects the shop’s WhatsApp under': 'నిజమైన సందేశాలు పంపడానికి, యజమాని షాప్ వాట్సాప్‌ను ఇక్కడ కనెక్ట్ చేయాలి:', 'Settings → Connect WhatsApp': 'సెట్టింగ్‌లు → వాట్సాప్ కనెక్ట్',
  // Menu
  Home: 'హోమ్', Send: 'పంపండి', 'Send a message': 'సందేశం పంపండి', 'Sent messages': 'పంపిన సందేశాలు', Customers: 'కస్టమర్లు', Replies: 'జవాబులు',
  'Special days': 'ప్రత్యేక రోజులు', Templates: 'టెంప్లేట్‌లు', Interested: 'ఆసక్తి ఉన్నవారు', Chats: 'చాట్‌లు', 'Sales codes': 'సేల్స్ కోడ్‌లు', Settings: 'సెట్టింగ్‌లు',
  Menu: 'మెనూ', 'Sign out': 'సైన్ అవుట్', Owner: 'యజమాని', Staff: 'సిబ్బంది', 'Test mode': 'టెస్ట్ మోడ్', Live: 'లైవ్', 'WhatsApp not connected': 'వాట్సాప్ కనెక్ట్ కాలేదు',
  'Test mode: nothing is sent': 'టెస్ట్ మోడ్: ఏదీ పంపబడదు', 'Messages are pretend: nothing reaches real phones.': 'సందేశాలు నిజమైనవి కావు: నిజమైన ఫోన్‌లకు ఏదీ వెళ్లదు.', 'Messages go to real customers.': 'సందేశాలు నిజమైన కస్టమర్లకు వెళ్తాయి.', 'Go live': 'లైవ్‌కు వెళ్లండి', 'Fix in Settings': 'సెట్టింగ్‌లలో సరిచేయండి', 'WhatsApp messages': 'వాట్సాప్ సందేశాలు', Language: 'భాష',
  'Customers who tapped “Interested”. Call them today, while they’re keen.': '“ఆసక్తి ఉంది” నొక్కిన కస్టమర్లు. ఈ రోజే కాల్ చేయండి.',
  // Home
  'Good morning, {name}': 'శుభోదయం, {name}', 'Good afternoon, {name}': 'నమస్కారం, {name}', 'Good evening, {name}': 'శుభ సాయంత్రం, {name}',
  'Here’s what needs you today.': 'ఈ రోజు మీరు చేయాల్సినవి ఇవి.', 'What to do today': 'ఈ రోజు చేయాల్సినవి',
  '{n} said Interested': '{count} మంది ఆసక్తి చూపారు', 'Call them today, while they’re keen.': 'ఆసక్తి ఉన్నప్పుడే, ఈ రోజే కాల్ చేయండి.',
  '{n} waiting more than a day': '{count} మంది ఒక రోజుకు పైగా ఎదురుచూస్తున్నారు', 'Call them now: interest fades fast.': 'ఇప్పుడే కాల్ చేయండి: ఆసక్తి త్వరగా తగ్గిపోతుంది.',
  '{n} new': '{count} కొత్త జవాబులు', 'Answer them from here. Replies within 24 hours are free.': 'ఇక్కడి నుండే జవాబివ్వండి. 24 గంటల్లోపు జవాబులు ఉచితం.',
  Call: 'కాల్', 'Call now': 'ఇప్పుడే కాల్', Answer: 'జవాబు', Check: 'చూడండి', 'Set up': 'సెట్ చేయండి', Download: 'డౌన్‌లోడ్',
  'Nothing waiting for you': 'మీ కోసం ఏదీ ఎదురుచూడటం లేదు', 'A good day to send a message.': 'ఆఫర్ పంపడానికి మంచి రోజు.',
  'This month in numbers': 'ఈ నెల లెక్కలు', 'See numbers': 'లెక్కలు చూడండి', Hide: 'దాచండి', 'Recent messages': 'ఇటీవలి ఆఫర్లు', 'See all': 'అన్నీ చూడండి',
  'Wishes go out every morning on their own.': 'శుభాకాంక్షలు ప్రతి ఉదయం వాటంతటవే వెళ్తాయి.', 'Switch on birthday wishes': 'పుట్టినరోజు శుభాకాంక్షలు ఆన్ చేయండి',
  // Send a message
  'Four short steps. You see the message and the cost as you go.': 'నాలుగు చిన్న దశలు. సందేశం, ఖర్చు మీకు కనిపిస్తూనే ఉంటాయి.',
  'Who gets it': 'ఎవరికి', Message: 'సందేశం', When: 'ఎప్పుడు', 'Check & send': 'చూసి పంపండి', 'Send by': 'ఎలా పంపాలి',
  'Who gets it?': 'ఎవరికి పంపాలి?', 'What should it say?': 'సందేశం ఏమిటి?', 'When should it go out?': 'ఎప్పుడు పంపాలి?', 'Check and send': 'చూసి పంపండి',
  'Tap a ready-made message. Each customer’s name and details are added for you.': 'సిద్ధంగా ఉన్న సందేశాన్ని నొక్కండి. ప్రతి కస్టమర్ పేరు, వివరాలు ఆటోమేటిక్‌గా చేరుతాయి.',
  Diwali: 'దీపావళి', Dhanteras: 'ధనత్రయోదశి', 'Akshaya Tritiya': 'అక్షయ తృతీయ', 'New collection': 'కొత్త కలెక్షన్', 'Gold rate dropped': 'బంగారం ధర తగ్గింది', 'Wedding season': 'పెళ్లిళ్ల సీజన్',
  'Send now': 'ఇప్పుడే పంపండి', 'Schedule for later': 'తర్వాత పంపండి', Next: 'తదుపరి', Back: 'వెనక్కి',
  'Send a test to my phone first': 'ముందుగా నా ఫోన్‌కు టెస్ట్ పంపండి', 'Send test': 'టెస్ట్ పంపండి', Change: 'మార్చండి',
  'Send to {n} for {cost}': '{count} మందికి {cost} కు పంపండి', 'Send SMS to {n} for {cost}': '{count} మందికి SMS {cost} కు పంపండి',

  // Replies & call back
  'What customers wrote back, newest first.': 'కస్టమర్లు పంపిన జవాబులు, కొత్తవి ముందు.', Messages: 'సందేశాలు', All: 'అన్నీ', Unread: 'చదవనివి',
  'To call': 'కాల్ చేయాల్సినవి', Called: 'కాల్ చేశాం', Bought: 'కొన్నారు', 'Not interested': 'ఆసక్తి లేదు', Chat: 'చాట్', New: 'కొత్త',
  'Customers who tapped “Interested” or asked for a call. Call them today, while they’re keen.': '“ఆసక్తి ఉంది” నొక్కిన లేదా కాల్ అడిగిన కస్టమర్లు. ఈ రోజే కాల్ చేయండి.',
  // Sales codes
  'When a customer shows a code from their WhatsApp message, enter it here with the bill amount. Reports then show the real sales from each offer.':
    'కస్టమర్ వాట్సాప్ సందేశంలోని కోడ్ చూపిస్తే, బిల్ మొత్తంతో ఇక్కడ నమోదు చేయండి. ప్రతి ఆఫర్ వల్ల వచ్చిన అమ్మకాలు నివేదికలో కనిపిస్తాయి.',
  'Code from the customer’s message': 'కస్టమర్ సందేశంలోని కోడ్', 'Check code': 'కోడ్ చూడండి', 'Bill amount (₹)': 'బిల్ మొత్తం (₹)',
};

const HI = {
  '{n} went out today': 'आज {count} शुभकामनाएँ भेजी गईं', 'No birthdays or anniversaries today': 'आज कोई जन्मदिन या सालगिरह नहीं',
  'Your “{name}”: {sent} sent, {read} read it': 'आपका “{name}”: {sent} भेजे, {read} ने पढ़ा',
  'This month {n} bought with their code ({amount}).': 'इस महीने {count} ग्राहकों ने अपने कोड से खरीदा ({amount})।',
  'When a customer buys with their code, it shows here.': 'ग्राहक अपने कोड से खरीदे तो यहाँ दिखेगा।',
  'Test mode.': 'टेस्ट मोड।', 'Nothing is sent to real phones. Messages pretend to be delivered and then read within about a minute, so you can try everything safely.': 'असली फ़ोन पर कुछ नहीं भेजा जाता। संदेश एक मिनट में पहुँचे और पढ़े हुए दिखते हैं, ताकि आप बेझिझक सब आज़मा सकें।',
  'To send real messages, the owner connects the shop’s WhatsApp under': 'असली संदेश भेजने के लिए मालिक दुकान का व्हाट्सऐप यहाँ जोड़ें:', 'Settings → Connect WhatsApp': 'सेटिंग्स → व्हाट्सऐप जोड़ें',
  Home: 'होम', Send: 'भेजें', 'Send a message': 'संदेश भेजें', 'Sent messages': 'भेजे गए संदेश', Customers: 'ग्राहक', Replies: 'जवाब',
  'Special days': 'खास दिन', Templates: 'टेम्पलेट', Interested: 'रुचि वाले', Chats: 'चैट', 'Sales codes': 'सेल्स कोड', Settings: 'सेटिंग्स',
  Menu: 'मेनू', 'Sign out': 'साइन आउट', Owner: 'मालिक', Staff: 'स्टाफ़', 'Test mode': 'टेस्ट मोड', Live: 'लाइव', 'WhatsApp not connected': 'व्हाट्सऐप नहीं जुड़ा',
  'Test mode: nothing is sent': 'टेस्ट मोड: कुछ नहीं भेजा जाता', 'Messages are pretend: nothing reaches real phones.': 'संदेश असली नहीं हैं: असली फ़ोन तक कुछ नहीं जाता।', 'Messages go to real customers.': 'संदेश असली ग्राहकों तक जाते हैं।', 'Go live': 'लाइव करें', 'Fix in Settings': 'सेटिंग्स में ठीक करें', 'WhatsApp messages': 'व्हाट्सऐप संदेश', Language: 'भाषा',
  'Customers who tapped “Interested”. Call them today, while they’re keen.': 'जिन ग्राहकों ने “रुचि है” दबाया। आज ही कॉल करें।',
  'Good morning, {name}': 'सुप्रभात, {name}', 'Good afternoon, {name}': 'नमस्ते, {name}', 'Good evening, {name}': 'शुभ संध्या, {name}',
  'Here’s what needs you today.': 'आज आपके लिए ये काम हैं।', 'What to do today': 'आज क्या करना है',
  '{n} said Interested': '{count} ग्राहकों ने रुचि दिखाई', 'Call them today, while they’re keen.': 'आज ही कॉल करें, जब तक रुचि बनी है।',
  '{n} waiting more than a day': '{count} ग्राहक एक दिन से ज़्यादा से इंतज़ार में', 'Call them now: interest fades fast.': 'अभी कॉल करें: रुचि जल्दी कम हो जाती है।',
  '{n} new': '{count} नए जवाब', 'Answer them from here. Replies within 24 hours are free.': 'यहीं से जवाब दें। 24 घंटे के अंदर जवाब मुफ़्त हैं।',
  Call: 'कॉल', 'Call now': 'अभी कॉल', Answer: 'जवाब दें', Check: 'देखें', 'Set up': 'सेट करें', Download: 'डाउनलोड',
  'Nothing waiting for you': 'कोई काम बाकी नहीं', 'A good day to send a message.': 'ऑफ़र भेजने का अच्छा दिन।',
  'This month in numbers': 'इस महीने के आँकड़े', 'See numbers': 'आँकड़े देखें', Hide: 'छिपाएँ', 'Recent messages': 'हाल के ऑफ़र', 'See all': 'सब देखें',
  'Wishes go out every morning on their own.': 'शुभकामनाएँ हर सुबह अपने आप जाती हैं।', 'Switch on birthday wishes': 'जन्मदिन की शुभकामनाएँ चालू करें',
  'Four short steps. You see the message and the cost as you go.': 'चार छोटे कदम। संदेश और खर्च साथ-साथ दिखते हैं।',
  'Who gets it': 'किसे', Message: 'संदेश', When: 'कब', 'Check & send': 'देखें और भेजें', 'Send by': 'कैसे भेजें',
  'Who gets it?': 'किसे भेजें?', 'What should it say?': 'संदेश क्या हो?', 'When should it go out?': 'कब भेजें?', 'Check and send': 'देखें और भेजें',
  'Tap a ready-made message. Each customer’s name and details are added for you.': 'तैयार संदेश पर टैप करें। हर ग्राहक का नाम और जानकारी अपने आप जुड़ जाती है।',
  Diwali: 'दीपावली', Dhanteras: 'धनतेरस', 'Akshaya Tritiya': 'अक्षय तृतीया', 'New collection': 'नया कलेक्शन', 'Gold rate dropped': 'सोने के दाम घटे', 'Wedding season': 'शादी का मौसम',
  'Send now': 'अभी भेजें', 'Schedule for later': 'बाद में भेजें', Next: 'आगे', Back: 'पीछे',
  'Send a test to my phone first': 'पहले मेरे फ़ोन पर टेस्ट भेजें', 'Send test': 'टेस्ट भेजें', Change: 'बदलें',
  'Send to {n} for {cost}': '{count} ग्राहकों को {cost} में भेजें', 'Send SMS to {n} for {cost}': '{count} ग्राहकों को SMS {cost} में भेजें',

  'What customers wrote back, newest first.': 'ग्राहकों के जवाब, नए पहले।', Messages: 'संदेश', All: 'सब', Unread: 'अनपढ़े',
  'To call': 'कॉल करना है', Called: 'कॉल किया', Bought: 'खरीदा', 'Not interested': 'रुचि नहीं', Chat: 'चैट', New: 'नया',
  'Customers who tapped “Interested” or asked for a call. Call them today, while they’re keen.': 'जिन ग्राहकों ने “रुचि है” दबाया या कॉल माँगा। आज ही कॉल करें।',
  'When a customer shows a code from their WhatsApp message, enter it here with the bill amount. Reports then show the real sales from each offer.':
    'ग्राहक अपने व्हाट्सऐप संदेश का कोड दिखाए तो उसे बिल की रकम के साथ यहाँ डालें। रिपोर्ट में हर ऑफ़र की असली बिक्री दिखेगी।',
  'Code from the customer’s message': 'ग्राहक के संदेश का कोड', 'Check code': 'कोड देखें', 'Bill amount (₹)': 'बिल की रकम (₹)',
};

// Every screen's text (i18n-screens.json), with the hand-placed t() words above taking priority.
const DICT = { te: { ...SCREENS.te, ...TE }, hi: { ...SCREENS.hi, ...HI } };

const LangCtx = createContext({ lang: 'en', setLang: () => {}, t: (s) => s });

function read() {
  try {
    return localStorage.getItem('st_lang') || 'en';
  } catch {
    return 'en';
  }
}

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(read);
  const value = useMemo(() => {
    const dict = DICT[lang] || {};
    const t = (text, vars = {}) => String(dict[text] ?? text).replace(/\{(\w+)\}/g, (all, k) => (k in vars ? vars[k] : all));
    const setLang = (code) => {
      setLangState(code);
      try {
        localStorage.setItem('st_lang', code);
      } catch {
        // private window: the choice lasts until the page closes
      }
      document.documentElement.lang = code;
    };
    return { lang, setLang, t };
  }, [lang]);
  // The rest of each screen follows the same language.
  useEffect(() => {
    translateScreens(lang === 'en' ? null : DICT[lang]);
  }, [lang]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export const useT = () => useContext(LangCtx);
