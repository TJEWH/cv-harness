import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import InputText from 'primevue/inputtext';
import InputNumber from 'primevue/inputnumber';
import Select from 'primevue/select';
import Textarea from 'primevue/textarea';
import App from './app/App.vue';
import './assets/cv.css';

import { library } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import {
  faArrowDown,
  faArrowLeft,
  faArrowRight,
  faArrowsLeftRightToLine,
  faBriefcase,
  faCheck,
  faChevronLeft,
  faChevronRight,
  faCode,
  faDownload,
  faEnvelope,
  faEye,
  faEyeSlash,
  faFilePdf,
  faFolderOpen,
  faFont,
  faGlobe,
  faGraduationCap,
  faGripVertical,
  faHeart,
  faInfoCircle,
  faLanguage,
  faLayerGroup,
  faLink,
  faLinkSlash,
  faLocationDot,
  faLock,
  faLockOpen,
  faPalette,
  faPhone,
  faPlus,
  faSpinner,
  faSliders,
  faTableCellsLarge,
  faTableColumns,
  faTag,
  faTrash,
  faUserSecret,
  faWindowMaximize,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { faGithub, faLinkedin } from '@fortawesome/free-brands-svg-icons';

library.add(
  faArrowDown,
  faArrowLeft,
  faArrowRight,
  faArrowsLeftRightToLine,
  faBriefcase,
  faCheck,
  faChevronLeft,
  faChevronRight,
  faCode,
  faDownload,
  faEnvelope,
  faEye,
  faEyeSlash,
  faFilePdf,
  faFolderOpen,
  faFont,
  faGithub,
  faGlobe,
  faGraduationCap,
  faGripVertical,
  faHeart,
  faInfoCircle,
  faLanguage,
  faLayerGroup,
  faLinkedin,
  faLink,
  faLinkSlash,
  faLocationDot,
  faLock,
  faLockOpen,
  faPalette,
  faPhone,
  faPlus,
  faSpinner,
  faSliders,
  faTableCellsLarge,
  faTableColumns,
  faTag,
  faTrash,
  faUserSecret,
  faWindowMaximize,
  faXmark,
);

const app = createApp(App);
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: { darkModeSelector: '.app-dark' },
  },
});
document.documentElement.classList.add('app-dark');
app.component('InputText', InputText);
app.component('InputNumber', InputNumber);
app.component('Select', Select);
app.component('Textarea', Textarea);
app.component('font-awesome-icon', FontAwesomeIcon);

app.mount('#app');
