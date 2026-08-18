// Data tables for SPOTS desktop. Mirrors the structure of spots-app-main:
//   - body-part subcategory keys: app/_lib/services/body-parts/body-part-symptom-service.ts
//   - activity slugs:             app/_lib/services/activities/activity-symptom-service.ts
//   - feeling list/order:         app/_lib/services/spots/feelings-service.ts
//   - PRO-CTCAE options + seed symptoms: app/_lib/services/search/mock-symptoms-data.ts
// Production fetches the full symptom corpus live from REDCap (project SPOTSV2_PRO_CTCAE
// via AWS Lambda; see app/api/symptoms/templates/route.ts), so the per-subcategory
// lists below mix the authoritative seed terms from mock-symptoms-data.ts with
// pediatric-friendly fallbacks for subcategories REDCap normally fills in.
window.SPOTS_DATA = (function () {

  // ---------- Body parts ----------
  // key matches body-part-symptom-service.ts BODY_PART_TO_SUBCATEGORY values,
  // image filenames match /assets/BodyParts-Final/<File>.jpg
  const bodyParts = [
    { key: 'head',        label: 'Head' ,          image: 'Head.jpg' },
    { key: 'hair_scalp',  label: 'Hair / Scalp' , image: 'Hair_Scalp.jpg' },
    { key: 'left_eye',    label: 'Left Eye' ,   image: 'Left_Eye.jpg' },
    { key: 'right_eye',   label: 'Right Eye' ,     image: 'Right_Eye.jpg' },
    { key: 'left_ear',    label: 'Left Ear' ,  image: 'Left_Ear.jpg' },
    { key: 'right_ear',   label: 'Right Ear' ,    image: 'Right_Ear.jpg' },
    { key: 'nose',        label: 'Nose' ,           image: 'Nose.jpg' },
    { key: 'mouth',       label: 'Mouth' ,            image: 'Mouth.jpg' },
    { key: 'neck_throat', label: 'Neck / Throat' , image: 'Neck_Throat.jpg' },
    { key: 'chest',       label: 'Chest' ,           image: 'Chest.jpg' },
    { key: 'abdomen',     label: 'Stomach' ,        image: 'Abdomen.jpg' },
    { key: 'back',        label: 'Back' ,         image: 'Back.jpg' },
    { key: 'buttocks',    label: 'Buttocks' ,         image: 'Buttocks.jpg' },
    { key: 'skin',        label: 'Skin' ,            image: 'Skin.jpg' },
    { key: 'left_arm',    label: 'Left Arm' , image: 'Left_Arm.jpg' },
    { key: 'right_arm',   label: 'Right Arm' ,   image: 'Right_Arm.jpg' },
    { key: 'left_hand',   label: 'Left Hand' ,  image: 'Left_Hand.jpg' },
    { key: 'right_hand',  label: 'Right Hand' ,    image: 'Right_Hand.jpg' },
    { key: 'left_leg',    label: 'Left Leg' ,image: 'Left_Leg.jpg' },
    { key: 'right_leg',   label: 'Right Leg' ,  image: 'Right_Leg.jpg' },
    { key: 'left_foot',   label: 'Left Foot' ,   image: 'Left_Foot.jpg' },
    { key: 'right_foot',  label: 'Right Foot' ,     image: 'Right_Foot.jpg' },
  ];

  // Per-subcategory symptom terms.
  // Entries marked "REDCap" are the exact symptomTerm values from
  // mock-symptoms-data.ts (the authoritative seed shipped in spots-app-main);
  // the rest are pediatric-friendly fallbacks for subcategories whose REDCap
  // rows aren't checked into the repo.
  const bodyPartSymptoms = {
    // REDCap seed: headache
    head:        ['Headache', 'Feeling tired', 'Pain', 'Worried or nervous feeling', 'Sad or unhappy feelings', 'Pimples'],
    hair_scalp:  ['Itchy scalp', 'Dandruff', 'Hair loss', 'Sores or bumps'],
    left_eye:    ['Eye pain', 'Blurry vision', 'Watery eye', 'Itchy eye'],
    right_eye:   ['Eye pain', 'Blurry vision', 'Watery eye', 'Itchy eye'],
    left_ear:    ['Ear pain', 'Trouble hearing', 'Ringing in the ear', 'Itchy ear'],
    right_ear:   ['Ear pain', 'Trouble hearing', 'Ringing in the ear', 'Itchy ear'],
    nose:        ['Runny nose', 'Stuffy nose', 'Nosebleed', 'Sneezing'],
    mouth:       ['Sore throat', 'Mouth sores', 'Dry mouth', 'Tooth pain'],
    neck_throat: ['Sore throat', 'Trouble swallowing', 'Stiff neck', 'Swollen glands'],
    // REDCap seed: cough, shortness_breath
    chest:       ['Cough', 'Shortness of breath', 'Chest pain', 'Fast heartbeat'],
    // REDCap seed: abdo_pain, nausea, vomiting
    abdomen:     ['Stomach pain', 'Feel sick to stomach', 'Vomiting', 'Constipation', 'Runny or watery poop'],
    back:        ['Back pain', 'Stiffness', 'Bumps or rash'],
    buttocks:    ['Pain', 'Rash', 'Itching', 'Runny or watery poop'],
    skin:        ['Itchy red bumps on skin', 'Itching', 'Bruising', 'Dry skin', 'Sores'],
    left_arm:    ['Arm pain', 'Weakness', 'Numbness or tingly feeling', 'Bruise'],
    right_arm:   ['Arm pain', 'Weakness', 'Numbness or tingly feeling', 'Bruise'],
    left_hand:   ['Hand pain', 'Numbness or tingly feeling in hands or feet', 'Trouble gripping'],
    right_hand:  ['Hand pain', 'Numbness or tingly feeling in hands or feet', 'Trouble gripping'],
    left_leg:    ['Leg pain', 'Cramps', 'Weakness', 'Limping'],
    right_leg:   ['Leg pain', 'Cramps', 'Weakness', 'Limping'],
    left_foot:   ['Foot pain', 'Numbness or tingly feeling in hands or feet', 'Blister'],
    right_foot:  ['Foot pain', 'Numbness or tingly feeling in hands or feet', 'Blister'],
  };

  // ---------- Activities (slug + image) ----------
  const activities = [
    { key: 'bathing',       label: 'Bathing' ,           image: 'Bathing.jpg' },
    { key: 'eating',        label: 'Eating' ,             image: 'Eating.jpg' },
    { key: 'getting_ready', label: 'Getting Ready' ,        image: 'Getting_Ready.jpg' },
    { key: 'reading',       label: 'Reading' ,              image: 'Reading.jpg' },
    { key: 'running',       label: 'Running' ,            image: 'Running.jpg' },
    { key: 'screen_time',   label: 'Screen Time' ,image: 'Screen_Time.jpg' },
    { key: 'sleeping',      label: 'Sleeping' ,            image: 'Sleeping.jpg' },
    { key: 'talking',       label: 'Talking' ,            image: 'Talking.jpg' },
    { key: 'thinking',      label: 'Thinking' ,            image: 'Thinking.jpg' },
    { key: 'toileting',     label: 'Toileting' ,        image: 'Toileting.jpg' },
    { key: 'walking',       label: 'Walking' ,           image: 'Walking.jpg' },
  ];

  // Activity-specific problem prompts. mock-symptoms-data.ts maps:
  //   fatigue → walking, running, bathing
  //   sleep_problems → sleeping
  // Other activity rows use pediatric-friendly fallbacks.
  const activitySymptoms = {
    bathing:       ['Fatigue', 'Pain', 'Worried or nervous feelings', 'Trouble with bathing'],
    eating:        ['Feel sick to stomach', 'Vomiting', 'Pain', 'Loss of appetite', 'Tummy hurts after eating'],
    getting_ready: ['Fatigue', 'Pain', 'Trouble getting dressed', 'Trouble brushing hair or teeth'],
    reading:       ['Headache', 'Trouble focusing', 'Eyes hurt', 'Fatigue'],
    running:       ['Fatigue', 'Pain', 'Shortness of breath', 'Cough'],
    screen_time:   ['Headache', 'Eye strain', 'Fatigue', 'Trouble looking at screens'],
    sleeping:      ['Sleep problems', 'Fatigue', 'Pain', 'Cough', 'Worried or nervous feelings'],
    talking:       ['Sore throat when talking', 'Trouble finding words', 'Voice is hoarse'],
    thinking:      ['Trouble concentrating', 'Forgetting things', 'Worried or nervous feelings', 'Sad or unhappy feelings'],
    toileting:     ['Pain when going', 'Constipation', 'Runny or watery poop', 'Going too often'],
    walking:       ['Fatigue', 'Pain', 'Shortness of breath', 'Trouble keeping balance'],
  };

  // ---------- Feelings ----------
  const feelings = [
    { key: 'fatigue',               label: 'Feeling tired' ,                                                                  image: 'Fatigue.jpg' },
    { key: 'anxiety',               label: 'Worried or nervous feelings' ,                                              image: 'Anxiety.jpg' },
    { key: 'depression',            label: 'Sad or unhappy feelings' ,                                                  image: 'Depression.jpg' },
    { key: 'concentration_problem', label: 'Problems paying attention (focusing on TV, reading, or school work)' ,        image: 'Concentration_Problem.jpg' },
    { key: 'memory_problem',        label: 'Problems remembering things' ,                                                           image: 'Memory_Problem.jpg' },
    { key: 'restlessness',          label: 'Not being able to sit still' ,                                                                image: 'Restlessness.jpg' },
    { key: 'suicidal_ideation',     label: 'Think about hurting yourself' ,                                                                  image: 'Suicidal_Ideation.jpg' },
  ];

  // ---------- Searchable corpus ----------
  // Built dynamically from above lists so adding to one list updates search.
  function buildSearchCorpus() {
    const items = [];
    bodyParts.forEach(bp => {
      (bodyPartSymptoms[bp.key] || []).forEach(s => {
        items.push({ name: s, category: 'body_parts', subcategory: bp.key, contextLabel: bp.label });
      });
    });
    activities.forEach(act => {
      (activitySymptoms[act.key] || []).forEach(s => {
        items.push({ name: s, category: 'activities', subcategory: act.key, contextLabel: act.label });
      });
    });
    feelings.forEach(f => {
      items.push({ name: f.label, category: 'feelings', subcategory: f.key, contextLabel: 'Feelings' });
    });
    // De-dupe by (name + subcategory)
    const seen = new Set();
    return items.filter(it => {
      const k = it.name.toLowerCase() + '|' + it.subcategory;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // ---------- PRO-CTCAE rating questions ----------
  // Option labels mirror mock-symptoms-data.ts (the production PRO-CTCAE
  // Pediatric scale). prompt strings paraphrase the per-symptom prompts that
  // REDCap returns at runtime in the production app.
  //
  // NOT every symptom uses every question. Per production
  // app/_lib/services/pro-ctcae/question-service.ts (QUESTION_PROGRESSION_RULES):
  //   body_parts  → frequency, severity, interference   (3 questions)
  //   activities  → frequency, severity, interference   (3 questions)
  //   search      → frequency, severity, interference   (3 questions)
  //   feelings    → frequency, severity                 (2 questions, no interference)
  // The desktop build's `questionIdsForSymptom()` (app.js) selects the
  // per-symptom subset; this table provides the prompt + option text for
  // each question id. Note `interference` is opt-in per category — leave it
  // here even though feelings won't reach it.
  const ratingQuestions = [
    {
      id: 'frequency',
      prompt: 'How often did this happen in the last 7 days?',
      options: [
        { value: 0, label: 'Never' },
        { value: 1, label: 'Sometimes' },
        { value: 2, label: 'Most of the time' },
        { value: 3, label: 'Almost all the time' },
      ],
    },
    {
      id: 'severity',
      prompt: 'How bad was it at its worst?',
      options: [
        { value: 0, label: 'Did not have any' },
        { value: 1, label: 'A little bad' },
        { value: 2, label: 'Bad' },
        { value: 3, label: 'Very bad' },
      ],
    },
    {
      id: 'interference',
      prompt: 'How much did it get in the way of things you wanted to do?',
      options: [
        { value: 0, label: 'Not at all' },
        { value: 1, label: 'A little bit' },
        { value: 2, label: 'Somewhat' },
        { value: 3, label: 'Quite a bit' },
        { value: 4, label: 'Very much' },
      ],
    },
  ];

  // ---------- REDCap seed symptoms (mock-symptoms-data.ts) ----------
  // Authoritative seed list shipped with spots-app-main. Each entry mirrors
  // SymptomBusiness fields used by the production search/templating layer.
  const redcapSymptoms = [
    { id: 'abdo_pain',       term: 'Stomach pain',         categories: ['body_parts'], subcategories: ['abdomen'] },
    { id: 'nausea',          term: 'Feel sick to stomach', categories: ['body_parts'], subcategories: ['abdomen'] },
    { id: 'vomiting',        term: 'Vomiting',             categories: ['body_parts'], subcategories: ['abdomen'] },
    { id: 'headache',        term: 'Headache',             categories: ['body_parts'], subcategories: ['head'] },
    { id: 'cough',           term: 'Cough',                categories: ['body_parts'], subcategories: ['chest'] },
    { id: 'shortness_breath',term: 'Shortness of breath',  categories: ['body_parts'], subcategories: ['chest'] },
    { id: 'fatigue',         term: 'Fatigue',              categories: ['activities'], subcategories: ['walking', 'running', 'bathing'] },
    { id: 'sleep_problems',  term: 'Sleep problems',       categories: ['activities'], subcategories: ['sleeping'] },
    { id: 'anxiety',         term: 'Anxiety',              categories: ['feelings'],   subcategories: ['feelings'] },
    { id: 'depression',      term: 'Depression',           categories: ['feelings'],   subcategories: ['feelings'] },
  ];

  return {
    bodyParts,
    bodyPartSymptoms,
    activities,
    activitySymptoms,
    feelings,
    redcapSymptoms,
    searchCorpus: buildSearchCorpus(),
    ratingQuestions,
    assetPath(folder, file) { return `./assets/${folder}/${file}`; },
  };
})();
