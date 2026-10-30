import { createApp, h } from 'vue';
import OpportunityContext from '../../src/features/opportunities/components/OpportunityContext.vue';
import { livingStandardFixture } from '../fixtures/livingStandard';
import '../../src/assets/cv.css';

if (!import.meta.env.DEV) throw new Error('Development fixture only.');
createApp({ render: () => h('main', { style: 'padding:24px;max-width:1100px;margin:auto;font:14px/1.6 var(--font-ui);color:var(--ui-text);' }, [
  h('h1', 'Living standard · synthetic preview'),
  h(OpportunityContext, { context: { city: 'Example city', salary: { amount: 3204, currency: 'EUR', period: 'month', gross: true }, data: { living_standard: livingStandardFixture } }, lang: 'en', onlyGroups: ['salary'] }),
  h('section', { style: 'width:360px;max-width:100%;margin-top:32px;' }, [h('h2', 'Narrow layout'),
    h(OpportunityContext, { context: { salary: { amount: 3204 }, data: { living_standard: livingStandardFixture } }, lang: 'de', onlyGroups: ['salary'] })]),
  h(OpportunityContext, { context: { salary: { details: 'Funding amount not yet confirmed.' } }, lang: 'en', onlyGroups: ['salary'] }),
]) }).mount('#app');
