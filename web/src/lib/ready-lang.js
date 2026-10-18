// Telugu and Hindi versions of the ready-made messages (and their short SMS versions).
// Please have a native speaker read these once before sending to customers.
export const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'hi', label: 'हिन्दी' },
];

export const BUTTONS = {
  en: [{ type: 'quick_reply', text: 'Interested' }, { type: 'quick_reply', text: 'Not now' }],
  te: [{ type: 'quick_reply', text: 'ఆసక్తి ఉంది' }, { type: 'quick_reply', text: 'ఇప్పుడు కాదు' }],
  hi: [{ type: 'quick_reply', text: 'रुचि है' }, { type: 'quick_reply', text: 'अभी नहीं' }],
};

export const TRANSLATIONS = {
  diwali: {
    te: {
      body: 'నమస్కారం {{name}} గారు, {{store}} నుండి దీపావళి శుభాకాంక్షలు! మా కొత్త బంగారు, వజ్రాభరణాలతో పండుగను మరింత వెలుగులతో జరుపుకోండి. మీ కోసం: {{offer}}, {{offer_ends}} వరకు. బిల్లింగ్ సమయంలో మీ కోడ్ {{offer_code}} చూపించండి.',
      sms: '{{name}} గారు, {{store}} దీపావళి ఆఫర్: {{offer}}, {{offer_ends}} వరకు. కోడ్ {{offer_code}} -SWATHI',
    },
    hi: {
      body: 'नमस्ते {{name}} जी, {{store}} की ओर से दीपावली की शुभकामनाएँ! हमारे नए सोने और हीरे के गहनों के साथ त्योहार को और रोशन करें। आपके लिए: {{offer}}, {{offer_ends}} तक। बिलिंग के समय अपना कोड {{offer_code}} दिखाएँ।',
      sms: '{{name}} जी, {{store}} दीपावली ऑफ़र: {{offer}}, {{offer_ends}} तक। कोड {{offer_code}} -SWATHI',
    },
  },
  dhanteras: {
    te: {
      body: 'నమస్కారం {{name}} గారు, ధనత్రయోదశి బంగారం ఇంటికి తెచ్చుకోవడానికి అత్యంత శుభదినం. {{store}} లో: {{offer}}, {{offer_ends}} వరకు. మీ కోడ్: {{offer_code}}. “ఆసక్తి ఉంది” నొక్కండి, మీకు నచ్చిన డిజైన్లు సిద్ధంగా ఉంచుతాము.',
      sms: '{{name}} గారు, {{store}} ధనత్రయోదశి ఆఫర్: {{offer}}, {{offer_ends}} వరకు. కోడ్ {{offer_code}} -SWATHI',
    },
    hi: {
      body: 'नमस्ते {{name}} जी, धनतेरस सोना घर लाने का सबसे शुभ दिन है। {{store}} में: {{offer}}, {{offer_ends}} तक। आपका कोड: {{offer_code}}। “रुचि है” दबाएँ, हम आपकी पसंद के डिज़ाइन तैयार रखेंगे।',
      sms: '{{name}} जी, {{store}} धनतेरस ऑफ़र: {{offer}}, {{offer_ends}} तक। कोड {{offer_code}} -SWATHI',
    },
  },
  akshaya: {
    te: {
      body: 'నమస్కారం {{name}} గారు, అక్షయ తృతీయ నాడు కొన్న బంగారం శాశ్వత సంపదను తెస్తుందని నమ్మకం. {{store}} లో {{offer}} తో మీ బంగారం బుక్ చేసుకోండి, {{offer_ends}} వరకు. మీ కోడ్: {{offer_code}}.',
      sms: '{{name}} గారు, {{store}} అక్షయ తృతీయ ఆఫర్: {{offer}}, {{offer_ends}} వరకు. కోడ్ {{offer_code}} -SWATHI',
    },
    hi: {
      body: 'नमस्ते {{name}} जी, कहते हैं अक्षय तृतीया पर खरीदा सोना हमेशा समृद्धि लाता है। {{store}} में {{offer}} के साथ अपना सोना बुक करें, {{offer_ends}} तक। आपका कोड: {{offer_code}}।',
      sms: '{{name}} जी, {{store}} अक्षय तृतीया ऑफ़र: {{offer}}, {{offer_ends}} तक। कोड {{offer_code}} -SWATHI',
    },
  },
  new: {
    te: {
      body: 'నమస్కారం {{name}} గారు, మా కొత్త కలెక్షన్ వచ్చేసింది, మీ {{last_purchase}} కు చక్కగా జతయ్యే ఆభరణాలతో. {{store}} కి వచ్చి చూడండి: {{offer}}, {{offer_ends}} వరకు.',
      sms: '{{name}} గారు, {{store}} లో కొత్త కలెక్షన్: {{offer}}, {{offer_ends}} వరకు. -SWATHI',
    },
    hi: {
      body: 'नमस्ते {{name}} जी, हमारा नया कलेक्शन आ गया है, आपके {{last_purchase}} के साथ खूब जँचने वाले गहनों के साथ। {{store}} पर आकर देखें: {{offer}}, {{offer_ends}} तक।',
      sms: '{{name}} जी, {{store}} में नया कलेक्शन: {{offer}}, {{offer_ends}} तक। -SWATHI',
    },
  },
  rate: {
    te: {
      body: 'నమస్కారం {{name}} గారు, శుభవార్త: ఈ వారం బంగారం ధరలు తగ్గాయి, మీరు అనుకున్న ఆభరణం కొనడానికి ఇదే మంచి సమయం. {{store}} లో: {{offer}}, {{offer_ends}} వరకు. మీ కోడ్: {{offer_code}}.',
      sms: '{{name}} గారు, బంగారం ధరలు తగ్గాయి! {{store}}: {{offer}}, {{offer_ends}} వరకు. కోడ్ {{offer_code}} -SWATHI',
    },
    hi: {
      body: 'नमस्ते {{name}} जी, खुशखबरी: इस हफ़्ते सोने के दाम घटे हैं, मनपसंद गहना खरीदने का यही सही समय है। {{store}} में: {{offer}}, {{offer_ends}} तक। आपका कोड: {{offer_code}}।',
      sms: '{{name}} जी, सोने के दाम घटे! {{store}}: {{offer}}, {{offer_ends}} तक। कोड {{offer_code}} -SWATHI',
    },
  },
  wedding: {
    te: {
      body: 'నమస్కారం {{name}} గారు, ఇంట్లో పెళ్లి ఏర్పాట్లా? మా బంగారు, వజ్ర, పోల్కీ బ్రైడల్ సెట్లు వచ్చేశాయి. {{store}} లో ప్రశాంతంగా చూసేందుకు సమయం బుక్ చేసుకోండి, {{offer}} పొందండి, {{offer_ends}} వరకు.',
      sms: '{{name}} గారు, {{store}} లో బ్రైడల్ సెట్లు: {{offer}}, {{offer_ends}} వరకు. -SWATHI',
    },
    hi: {
      body: 'नमस्ते {{name}} जी, घर में शादी की तैयारी? हमारे सोने, हीरे और पोल्की के ब्राइडल सेट आ गए हैं। {{store}} पर आराम से देखने का समय बुक करें और पाएँ {{offer}}, {{offer_ends}} तक।',
      sms: '{{name}} जी, {{store}} में ब्राइडल सेट: {{offer}}, {{offer_ends}} तक। -SWATHI',
    },
  },
};

/** The ready-made message in a language: { name, body, sms, buttons, language }. */
export function readyIn(m, lang) {
  if (lang === 'en' || !TRANSLATIONS[m.key]?.[lang]) return { name: m.name, body: m.body, sms: m.sms, buttons: BUTTONS.en, language: 'en' };
  const tr = TRANSLATIONS[m.key][lang];
  const label = LANGS.find((l) => l.code === lang).label;
  return { name: `${m.name} · ${label}`, body: tr.body, sms: tr.sms, buttons: BUTTONS[lang], language: lang };
}
