<script setup lang="ts">
import type { Contact } from '../types';
import { safeEmailUrl, safeWebUrl } from '../../../shared/lib/safeUrl';
defineProps<{ contact: Contact }>();
</script>

<template>
  <address class="contact">
    <div v-if="contact.location">{{ contact.location }}<font-awesome-icon :icon="['fas', 'location-dot']" class="contact-icon" /></div>
    <div v-if="contact.email"><a :href="safeEmailUrl(contact.email) || undefined">{{ contact.email }}</a><font-awesome-icon :icon="['fas', 'envelope']" class="contact-icon" /></div>
    <div v-if="contact.phone">{{ contact.phone }}<font-awesome-icon :icon="['fas', 'phone']" class="contact-icon" /></div>
    <div v-if="contact.website"><a :href="safeWebUrl(contact.website) || undefined" rel="noreferrer">{{ contact.website.replace(/^https?:\/\//, '') }}</a><font-awesome-icon :icon="['fas', 'globe']" class="contact-icon" /></div>
    <div v-if="contact.linkedin"><a :href="safeWebUrl(contact.linkedin) || undefined" rel="noreferrer">{{ contact.linkedin.replace(/^https?:\/\//, '') }}</a><font-awesome-icon :icon="['fab', 'linkedin']" class="contact-icon" /></div>
    <div v-if="contact.github"><a :href="safeWebUrl(contact.github) || undefined" rel="noreferrer">{{ contact.github.replace(/^https?:\/\//, '') }}</a><font-awesome-icon :icon="['fab', 'github']" class="contact-icon" /></div>
  </address>
</template>
