<script setup lang="ts">
import { computed } from 'vue';
import PrivacyField from '../../../documents/privacy/components/PrivacyField.vue';
import type { Contact } from '../../../documents/cv/types';
import { SAMPLE_CONTACT } from '../../../documents/cv/defaults';
import { makeT } from '../../../i18n/dict';
const props = defineProps<{ contact: Contact; lang: string }>();
const t = makeT(computed(() => props.lang));
</script>

<template>
  <div class="contact-fields">
    <div class="grid-2"><PrivacyField :owner="contact" field="location" v-slot="{ disabled }"><label>{{ t('location') }}<InputText :disabled="disabled" v-model="contact.location" :placeholder="SAMPLE_CONTACT.location" fluid /></label></PrivacyField><PrivacyField :owner="contact" field="email" v-slot="{ disabled }"><label>{{ t('email') }}<InputText :disabled="disabled" v-model="contact.email" type="email" :placeholder="SAMPLE_CONTACT.email" fluid /></label></PrivacyField></div>
    <div class="grid-2"><PrivacyField :owner="contact" field="phone" v-slot="{ disabled }"><label>{{ t('phone') }}<InputText :disabled="disabled" v-model="contact.phone" type="tel" :placeholder="SAMPLE_CONTACT.phone" fluid /></label></PrivacyField><PrivacyField :owner="contact" field="website" v-slot="{ disabled }"><label>{{ t('website') }}<InputText :disabled="disabled" v-model="contact.website" type="url" :placeholder="SAMPLE_CONTACT.website" fluid /></label></PrivacyField></div>
    <div class="grid-2"><PrivacyField :owner="contact" field="linkedin" v-slot="{ disabled }"><label>{{ t('linkedin') }}<InputText :disabled="disabled" v-model="contact.linkedin" type="url" :placeholder="SAMPLE_CONTACT.linkedin" fluid /></label></PrivacyField><PrivacyField :owner="contact" field="github" v-slot="{ disabled }"><label>{{ t('github') }}<InputText :disabled="disabled" v-model="contact.github" type="url" :placeholder="SAMPLE_CONTACT.github" fluid /></label></PrivacyField></div>
  </div>
</template>

<style scoped>
.contact-fields { display: grid; gap: 8px; min-width: 0; }
</style>
