// Demo data for product shots. It lives only in a throwaway browser profile.
export function buildSeed() {
  const now = new Date();
  const at = (d, h = 9, m = 0) => { const x = new Date(now); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x.toISOString(); };
  const ymd = d => { const x = new Date(now); x.setDate(x.getDate() + d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };
  let n = 0; const id = p => `${p}-${++n}`;
  const base = (d, p) => ({ id: id(p), createdAt: at(d), updatedAt: at(d), deletedAt: null });
  const notes = [
    { ...base(-1,'n'), title: 'Weekend in Bandung', source: 'manual', tags: ['Travel'],
      content: 'Leaving Friday after work.\nStay near Braga.\n\nPacking\n- Jacket, it gets cold at night\n- Power bank\n- Tickets for the Whoosh\n\nBudget roughly 2jt for two nights.',
      html: '<p>Leaving Friday after work, back Sunday evening. Stay near Braga so we can walk to breakfast.</p><h2>Packing</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>Whoosh tickets for two</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Jacket, it gets cold at night</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Power bank</p></div></li></ul><h2>Where to eat</h2><ul><li><p>Kopi Toko Djawa for breakfast</p></li><li><p>Batagor Kingsley, ask Budi which branch</p></li><li><p>Dago at sunset if the weather holds</p></li></ul><p>Budget roughly 2jt for two nights.</p>' },
    { ...base(-3,'n'), title: 'Rent contract 2026', source: 'ocr', tags: ['Home'], content: 'Renews in March. Deposit is two months. Ask about the water bill before signing.' },
    { ...base(-4,'n'), title: 'Venue shortlist', source: 'recording', tags: ['Work'], content: 'Dimas prefers the second floor at Kopi Tuku. Deposit still open, due Monday.' },
    { ...base(-6,'n'), title: 'Gift ideas for Mum', source: 'manual', tags: ['Ideas'], content: 'A good kebaya fabric, or the tea set she liked in Solo.' },
    { ...base(-8,'n'), title: 'Reading list', source: 'chat', tags: ['Ideas'], content: 'Bumi Manusia, again. The Creative Act. Whatever Sarah recommends next.' },
  ];
  const trip = notes[0].id;
  const todo = (d, h, title, extra = {}) => ({ ...base(-1,'t'), title, done: false, priority: 'medium', source: 'manual', dueAt: at(d, h), remindAt: null, ...extra });
  const todos = [
    todo(0, 14, 'Send the Q3 invoice to Studio Kopi', { priority: 'high', postponed: { count: 3, at: at(-1) } }),
    todo(0, 16, "Review Sarah's mockups", { doing: true }),
    todo(0, 18, 'Buy groceries', { noteId: trip }),
    todo(0, 20, 'Water the plants', { rrule: 'FREQ=WEEKLY;INTERVAL=1', priority: 'low' }),
    todo(2, 10, 'Call Budi about the venue deposit', { notes: 'Dimas needs an answer by Monday.' }),
    todo(3, 9, 'Pay internet bill', { rrule: 'FREQ=MONTHLY;INTERVAL=1', remindAt: at(3, 8), bill: { amount: 350000, category: 'Bills & Utilities' } }),
    todo(5, 9, 'Renew my passport', { noteId: null }),
    todo(28, 9, 'Pay rent', { rrule: 'FREQ=MONTHLY;INTERVAL=1', bill: { amount: 2500000, category: 'Bills & Utilities' } }),
    { ...todo(-1, 10, 'Book the dentist'), done: true, completedAt: at(-1, 9), priority: 'low' },
  ];
  const tx = (d, merchant, amount, category, extra = {}) => ({ ...base(d,'x'), merchant, amount, currency: 'IDR', category, date: ymd(d), items: [], source: 'manual', ...extra });
  const transactions = [
    tx(0, 'Kopi Kenangan', 38000, 'Food & Drink'), tx(0, 'Gojek', 23000, 'Transport'),
    tx(-1, 'Indomaret', 87500, 'Groceries'), tx(-1, 'Warteg Bahari', 90000, 'Food & Drink', { splits: [{ name: 'Andi', amount: 30000, settled: false }, { name: 'Budi', amount: 30000, settled: true }] }),
    tx(-2, 'Gramedia', 128000, 'Education'), tx(-3, 'Grab', 48000, 'Transport'), tx(-4, 'Tokopedia', 214000, 'Shopping'),
    tx(-5, 'Netflix', 186000, 'Entertainment'), tx(-6, 'Sushi Tei', 312000, 'Food & Drink'),
    tx(-6, 'PLN', 520000, 'Bills & Utilities'),
    tx(-5, 'Salary', -12500000, 'Income'),
    tx(-33, 'Netflix', 186000, 'Entertainment'), tx(-33, 'PLN', 480000, 'Bills & Utilities'), tx(-34, 'Sushi Tei', 280000, 'Food & Drink'), tx(-36, 'Grab', 92000, 'Transport'),
  ];
  const stickies = [{ ...base(-1,'s'), text: 'Ask Dimas about the deposit', color: 'yellow', pinned: true }];
  const settings = { currency: 'IDR', voiceReplies: true, name: 'Rani', budgets: { 'Food & Drink': 1500000, Transport: 600000, Entertainment: 200000 }, updatedAt: at(-1) };
  const data = { notes, todos, transactions, stickies, summaries: [], briefs: [], settings, spaces: [], currentSpaceId: null };
  const seg = (speaker, start, end, text) => ({ speaker, start, end, text });
  const segments = [
    seg('A', 12, 19, 'So the venue, where did we land? Dimas, you went to see it.'),
    seg('B', 20, 31, 'I did. The second floor at Kopi Tuku works, forty seats, and they will hold it until Monday if we pay the deposit.'),
    seg('A', 32, 38, 'How much is the deposit?'),
    seg('B', 39, 46, 'One and a half million. Budi was going to call them.'),
    seg('C', 47, 58, "I can call Monday morning. I also want Sarah's mockups before we print anything."),
    seg('A', 60, 69, 'Fine. Sarah, can those land by Friday? And I will send the Q3 invoice today.'),
  ];
  const talk = { id: 'talk-1', createdAt: at(-1, 10), updatedAt: at(-1, 11), deletedAt: null, spaceId: null, title: 'Product sync', mode: 'call', app: 'Google Meet', lang: 'en-US', duration: 1934, status: 'done', engine: 'device', chunks: [], live: [], segments,
    names: { A: 'Rani', B: 'Dimas', C: 'Budi' },
    summary: { text: 'The team chose the second floor at Kopi Tuku. The deposit is open until Monday, and printing waits for Sarah\'s mockups.',
      keyPoints: ['Second floor at Kopi Tuku, forty seats', 'Rp 1,500,000 deposit holds it until Monday', 'Nothing goes to print before the mockups land'],
      actionItems: ['Budi calls the venue on Monday morning', 'Sarah sends the mockups by Friday', 'Rani sends the Q3 invoice today'],
      people: [{ speaker: 'B', profile: 'Saw the venue, prefers the second floor.' }, { speaker: 'C', profile: 'Will call about the deposit.' }] },
    hasAudio: false };
  const talk2 = { ...talk, id: 'talk-2', title: '1:1 with Sarah', duration: 1520, app: null, mode: 'room', createdAt: at(-3, 15), updatedAt: at(-3, 16), names: { A: 'Rani', B: 'Sarah', C: 'Sarah' }, summary: { ...talk.summary, text: 'Sarah wants more time on the mobile mockups. Friday still works if the copy lands by Wednesday.' } };
  const talk3 = { ...talk, id: 'talk-3', title: 'Client call, Studio Kopi', duration: 2710, createdAt: at(-5, 11), updatedAt: at(-5, 12), app: 'Zoom', names: { A: 'Rani', B: 'Pak Wayan', C: 'Pak Wayan' }, summary: { ...talk.summary, text: 'Studio Kopi approved the Q3 scope. The invoice goes out this week, payment within fourteen days.' } };
  return { data, talks: [talk, talk2, talk3] };
}
