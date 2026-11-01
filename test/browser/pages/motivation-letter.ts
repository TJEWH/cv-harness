/** Isolated visual fixture. All names, qualifications and institutions are synthetic.
 * Run with test/browser/vite.config.ts; no accounts, saved documents or backend access.
 */
import { computed, createApp, h, reactive, ref, watch } from 'vue';
import { library } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import {
  faArrowLeft, faChevronLeft, faChevronRight, faDownload, faEnvelope,
  faGlobe, faLocationDot, faPhone, faSpinner,
} from '@fortawesome/free-solid-svg-icons';
import { faGithub, faLinkedin } from '@fortawesome/free-brands-svg-icons';
import LetterFormattingControls from '../../../src/documents/letter/components/LetterFormattingControls.vue';
import LetterDocumentPreview from '../../../src/documents/letter/components/LetterDocumentPreview.vue';
import { createSampleDocument } from '../../../src/features/cv-studio/domain/builtinConfigurations';
import { DEFAULT_LETTER_FORMATTING } from '../../../src/documents/letter/domain/letterFormatting';
import type { LetterContent, LetterFormatting } from '../../../src/documents/letter/letterTypes';
import '../../../src/assets/cv.css';

if (!import.meta.env.DEV) throw new Error('The browser fixture is available only on the development server.');

library.add(faArrowLeft, faChevronLeft, faChevronRight, faDownload, faEnvelope, faGlobe, faLocationDot, faPhone, faSpinner, faGithub, faLinkedin);

const englishParagraphs = [
  'I am applying for the doctoral position in Human-Centred Computing at Example University. My research interest is how interfaces can help people understand uncertainty when making consequential decisions. During my master’s studies in computer science, I became particularly interested in the relationship between statistical evidence, visual explanation, and trust. I would welcome the opportunity to develop this interest through rigorous, collaborative research within your department.',
  'My master’s thesis examined how alternative visual representations affected the interpretation of uncertain predictions. I designed an interactive prototype, developed a reproducible evaluation procedure, and analysed participants’ responses using quantitative and qualitative methods. The project taught me to translate a broad question into a testable study, document limitations carefully, and revise an approach when early findings challenged my expectations. It also strengthened my ability to communicate technical decisions to people with different disciplinary backgrounds.',
  'Alongside my academic work, I contributed to a research software project that made experimental materials easier to reproduce. My responsibilities included implementing accessible interface components, maintaining automated checks, and documenting data transformations. Working with researchers and designers helped me appreciate how reliable software supports credible empirical work. I learned to plan achievable milestones, seek feedback early, and distinguish an interesting prototype from a tool that others can understand and use independently.',
  'Your group’s focus on interactive explanations closely matches the questions I hope to investigate. I would like to explore when explanations improve a person’s understanding and when they create unjustified confidence. One possible starting point would compare representations of uncertainty across tasks with different levels of complexity. I would refine this direction with my supervisor and the research team, taking account of the available evidence, ethical considerations, and the programme’s priorities. I am especially interested in combining careful experimental design with qualitative insight into participants’ reasoning.',
  'Doctoral study would allow me to build the methodological depth required for independent research while contributing to a supportive academic community. I would bring practical software skills, experience working across disciplines, and a willingness to examine assumptions openly. In the longer term, I hope to pursue research that makes complex computational systems more understandable and useful. The opportunity to exchange ideas through seminars, teaching, and shared research would be an important part of that development.',
  'Thank you for considering my application. I would welcome the opportunity to discuss my research interests, preparation, and potential contribution to your group in an interview. My curriculum vitae and supporting academic documents provide further details of the experience outlined above.',
];

const germanParagraphs = [
  'Hiermit bewerbe ich mich um die Promotionsstelle im Bereich Menschzentrierte Informatik an der Beispieluniversität. Mich interessiert, wie interaktive Systeme Menschen dabei unterstützen können, Unsicherheit bei anspruchsvollen Entscheidungen zu verstehen. Während meines Masterstudiums der Informatik habe ich mich besonders mit dem Zusammenspiel von statistischer Evidenz, visuellen Erklärungen und Vertrauen beschäftigt. Diese Fragen möchte ich in Ihrer Arbeitsgruppe durch sorgfältige empirische Forschung weiter untersuchen.',
  'In meiner Masterarbeit untersuchte ich, wie unterschiedliche visuelle Darstellungen die Interpretation unsicherer Vorhersagen beeinflussen. Dafür entwickelte ich einen interaktiven Prototyp, plante ein reproduzierbares Untersuchungsverfahren und analysierte die Antworten der Teilnehmenden mit quantitativen und qualitativen Methoden. Dabei lernte ich, eine breite Forschungsfrage in überprüfbare Annahmen zu übersetzen, Grenzen der Untersuchung nachvollziehbar zu dokumentieren und mein Vorgehen aufgrund früher Ergebnisse anzupassen. Zugleich vertiefte ich meine Fähigkeit, technische Entscheidungen verständlich zu begründen.',
  'Ergänzend zum Studium arbeitete ich an einem Forschungssoftwareprojekt mit, das die Wiederverwendung experimenteller Materialien erleichterte. Zu meinen Aufgaben gehörten barrierearme Oberflächen, automatisierte Prüfungen und die Dokumentation von Datenaufbereitungen. Die Zusammenarbeit mit Forschenden und Gestaltenden zeigte mir, wie verlässliche Software die Qualität empirischer Arbeit unterstützt. Ich lernte außerdem, realistische Meilensteine zu planen, frühzeitig Rückmeldungen einzuholen und Ergebnisse so aufzubereiten, dass andere sie eigenständig nachvollziehen können.',
  'Der Schwerpunkt Ihrer Arbeitsgruppe auf interaktiven Erklärungen passt zu den Fragen, die ich in einer Promotion bearbeiten möchte. Ich möchte untersuchen, unter welchen Bedingungen Erklärungen das Verständnis verbessern und wann sie zu unbegründetem Vertrauen führen. Ein möglicher Ausgangspunkt wäre der Vergleich verschiedener Unsicherheitsdarstellungen in Aufgaben unterschiedlicher Komplexität. Diese Richtung würde ich gemeinsam mit meiner Betreuung und dem Forschungsteam präzisieren. Dabei wären der aktuelle Forschungsstand, ethische Anforderungen und die Ziele des Promotionsprojekts maßgeblich.',
  'Die Promotion bietet mir die Möglichkeit, meine methodischen Kenntnisse zu vertiefen und schrittweise ein eigenständiges Forschungsprofil zu entwickeln. Ich bringe praktische Erfahrung in der Softwareentwicklung, Freude an interdisziplinärer Zusammenarbeit und die Bereitschaft mit, eigene Annahmen kritisch zu überprüfen. Langfristig möchte ich dazu beitragen, komplexe rechnergestützte Systeme verständlicher und zugänglicher zu machen. Der Austausch in Seminaren, die Mitarbeit in der Lehre und die gemeinsame Diskussion von Ergebnissen sind für mich wesentliche Bestandteile dieses Weges.',
  'Vielen Dank für die Prüfung meiner Bewerbung. Gerne erläutere ich meine Forschungsinteressen, meine Vorbereitung und meinen möglichen Beitrag zu Ihrer Arbeitsgruppe in einem persönlichen Gespräch. Weitere Informationen zu den hier beschriebenen Erfahrungen finden Sie in meinem Lebenslauf und den beigefügten akademischen Unterlagen.',
];

const app = createApp({
  setup() {
    const state = reactive(createSampleDocument());
    state.lang = 'en';
    state.contact = {
      name: 'Alex Morgan', role: 'M.Sc. Computer Science', location: '14 Example Lane, 10115 Berlin',
      email: 'alex.morgan@example.org', phone: '+49 30 0000 0000',
      website: 'https://alex-morgan.example.org', linkedin: 'https://linkedin.com/in/synthetic-alex-morgan',
      github: 'https://github.com/synthetic-alex-morgan',
    };
    const language = ref('en');
    const length = ref('normal');
    const contentMode = ref('fields');
    const formatting = ref<LetterFormatting>();
    const formattingMode = computed(() => {
      const current = formatting.value;
      if (!current || (current.marginMm === DEFAULT_LETTER_FORMATTING.marginMm && current.fontSizePt === DEFAULT_LETTER_FORMATTING.fontSizePt && current.lineHeight === DEFAULT_LETTER_FORMATTING.lineHeight)) return 'default';
      return current.marginMm === 25 && current.fontSizePt === 12 && current.lineHeight === 1.5 ? 'custom' : 'adjusted';
    });
    const longSubject = ref(false);
    const sender = ref(true);
    const downloading = ref(false);
    const downloadError = ref('');
    const preview = ref<{ getPdfBlob(): Promise<Blob>; getRenderElement(): HTMLElement | null; open(): void } | null>(null);
    const content = reactive<LetterContent>({ subject: '', salutation: '', body: '', closing: '' });
    const words = computed(() => content.body.trim().split(/\s+/).filter(Boolean).length);
    const renderedContent = computed<LetterContent>(() => contentMode.value === 'plain'
      ? { subject: content.subject, salutation: '', body: [content.salutation, content.body, content.closing].filter(Boolean).join('\n\n'), closing: '' }
      : content);
    function resetContent() {
      const de = language.value === 'de';
      const paragraphs = de ? germanParagraphs : englishParagraphs;
      state.lang = language.value;
      content.subject = de
        ? 'Bewerbung um eine Promotionsstelle in Menschzentrierter Informatik'
        : 'Application for a PhD in Human-Centred Computing';
      if (longSubject.value) content.subject += de
        ? ' – Interaktive Erklärungen und verständliche Kommunikation von Unsicherheit in interdisziplinären Forschungskontexten'
        : ' — Interactive explanations and the communication of uncertainty in interdisciplinary research and consequential decision-making';
      content.salutation = de ? 'Sehr geehrte Mitglieder der Auswahlkommission,' : 'Dear Members of the Selection Committee,';
      content.body = (length.value === 'long' ? [...paragraphs.slice(0, -1), ...paragraphs.slice(1, -1), paragraphs.at(-1)!] : paragraphs).join('\n\n');
      content.closing = de ? 'Mit freundlichen Grüßen\nAlex Morgan' : 'Yours sincerely,\nAlex Morgan';
    }
    watch([language, length, longSubject], resetContent, { immediate: true });
    watch(sender, (show) => { state.disabled = show ? [] : ['header']; });

    async function download() {
      if (!preview.value || downloading.value) return;
      downloading.value = true;
      downloadError.value = '';
      try {
        const blob = await preview.value.getPdfBlob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `synthetic-phd-letter-${language.value}-${length.value}.pdf`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } catch (error) {
        downloadError.value = error instanceof Error ? error.message : 'The fixture PDF could not be exported.';
      } finally { downloading.value = false; }
    }

    function select(label: string, value: string, choices: [string, string][], change: (value: string) => void) {
      return h('label', { class: 'letter-fixture__field' }, [label,
        h('select', { value, 'aria-label': label, onChange: (event: Event) => change((event.target as HTMLSelectElement).value) }, choices.map(([value, label]) => h('option', { value }, label))),
      ]);
    }
    function check(label: string, value: boolean, change: (value: boolean) => void) {
      return h('label', { class: 'letter-fixture__check' }, [
        h('input', { type: 'checkbox', checked: value, onChange: (event: Event) => change((event.target as HTMLInputElement).checked) }), label,
      ]);
    }
    return () => h('main', { class: 'letter-fixture' }, [
      h('h1', 'PhD motivation letter styling'),
      h('p', { class: 'letter-fixture__intro' }, 'Development fixture · all applicant details, institutions and qualifications are synthetic.'),
      h('div', { class: 'letter-fixture__controls' }, [
        select('Language', language.value, [['en', 'English'], ['de', 'Deutsch']], (value) => { language.value = value; }),
        select('Contact layout', state.design.contactLayout || 'side', [['side', 'Beside name'], ['below', 'Below name']], (value) => { state.design.contactLayout = value; }),
        select('Header style', state.design.headerLayoutStyle || 'boxed', [['boxed', 'Boxed'], ['separator', 'Separator']], (value) => { state.design.headerLayoutStyle = value; }),
        select('Letter length', length.value, [['normal', 'Normal body'], ['long', 'Long body / two pages']], (value) => { length.value = value; }),
        select('Content structure', contentMode.value, [['fields', 'Separate fields'], ['plain', 'Plain edited letter']], (value) => { contentMode.value = value; }),
        select('Formatting preset', formattingMode.value, [
          ['default', `Default · ${DEFAULT_LETTER_FORMATTING.marginMm} mm / ${DEFAULT_LETTER_FORMATTING.fontSizePt} pt / ${DEFAULT_LETTER_FORMATTING.lineHeight}`],
          ['custom', 'Custom · 25 mm / 12 pt / 1.5'],
          ...(formattingMode.value === 'adjusted' ? [['adjusted', 'Manual adjustments'] as [string, string]] : []),
        ], (value) => { if (value !== 'adjusted') formatting.value = value === 'default' ? undefined : { marginMm: 25, fontSizePt: 12, lineHeight: 1.5 }; }),
        check('Long subject', longSubject.value, (value) => { longSubject.value = value; }),
        check('Show sender', sender.value, (value) => { sender.value = value; }),
      ]),
      h('div', { class: 'letter-fixture__actions' }, [
        h('button', { class: 'btn', type: 'button', onClick: () => preview.value?.open() }, 'Open PDF preview'),
        h('button', { class: 'btn btn--primary', type: 'button', disabled: downloading.value, onClick: download }, downloading.value ? 'Preparing PDF…' : 'Download fixture PDF'),
      ]),
      h('p', { class: 'letter-fixture__meta' }, `${words.value} body words · A4 · CV fonts, contacts and header settings · ${contentMode.value === 'plain' ? 'salutation and signature embedded in body' : 'separate salutation and closing fields'}`),
      h('p', { class: 'letter-fixture__mobile-hint' }, 'Open PDF preview to inspect the full letter on a small screen.'),
      downloadError.value ? h('p', { class: 'letter-fixture__error', role: 'alert' }, downloadError.value) : null,
      h('section', { class: 'letter-fixture__stage', 'aria-label': 'Letter PDF preview' }, [
        h(LetterDocumentPreview, { ref: preview, cvState: state, content: renderedContent.value, formatting: formatting.value, lang: language.value, previewKey: 'synthetic-phd-letter', hideActions: true, downloading: downloading.value, downloadError: downloadError.value, onDownload: download }),
      ]),
      h(LetterFormattingControls, { formatting: formatting.value, lang: language.value, onChange: (value: LetterFormatting | undefined) => { formatting.value = value; } }),
      h('details', { class: 'letter-fixture__edit' }, [
        h('summary', 'Edit fixture text'),
        h('p', 'Changes are temporary. Switching language or length restores the synthetic example.'),
        ...(['subject', 'salutation', 'body', 'closing'] as const).map((field) => h('label', [
          field[0].toUpperCase() + field.slice(1),
          h(field === 'subject' || field === 'salutation' ? 'input' : 'textarea', {
            value: content[field], 'data-field': field, 'aria-label': `Fixture ${field}`,
            onInput: (event: Event) => { content[field] = (event.target as HTMLInputElement | HTMLTextAreaElement).value; },
          }),
        ])),
      ]),
    ]);
  },
});
app.component('font-awesome-icon', FontAwesomeIcon);
app.mount('#app');
