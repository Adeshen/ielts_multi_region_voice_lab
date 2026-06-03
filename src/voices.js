export const voicePresets = {
  us_female: {
    id: "us_female",
    label: "American English - Female",
    shortLabel: "US Female",
    region: "United States",
    gender: "Female",
    speaker: "en_female_dacey_uranus_bigtts",
    resourceId: "seed-tts-2.0",
    fallbacks: [
      {
        speaker: "en_female_candice_emo_v2_mars_bigtts",
        resourceId: "seed-tts-1.0"
      }
    ]
  },
  us_male: {
    id: "us_male",
    label: "American English - Male",
    shortLabel: "US Male",
    region: "United States",
    gender: "Male",
    speaker: "en_male_tim_uranus_bigtts",
    resourceId: "seed-tts-2.0",
    fallbacks: [
      {
        speaker: "en_male_glen_emo_v2_mars_bigtts",
        resourceId: "seed-tts-1.0"
      }
    ]
  },
  uk_female: {
    id: "uk_female",
    label: "British English - Female",
    shortLabel: "UK Female",
    region: "United Kingdom",
    gender: "Female",
    speaker: "en_female_nadia_tips_emo_v2_mars_bigtts",
    resourceId: "seed-tts-1.0"
  },
  uk_male: {
    id: "uk_male",
    label: "British English - Male",
    shortLabel: "UK Male",
    region: "United Kingdom",
    gender: "Male",
    speaker: "en_male_corey_emo_v2_mars_bigtts",
    resourceId: "seed-tts-1.0"
  },
  au_male: {
    id: "au_male",
    label: "Australian English - Male",
    shortLabel: "AU Male",
    region: "Australia",
    gender: "Male",
    speaker: "en_male_glen_emo_v2_mars_bigtts",
    resourceId: "seed-tts-1.0"
  },
  en_expressive_female: {
    id: "en_expressive_female",
    label: "Expressive English - Female",
    shortLabel: "Expressive Female",
    region: "General English",
    gender: "Female",
    speaker: "en_female_candice_emo_v2_mars_bigtts",
    resourceId: "seed-tts-1.0"
  }
};

export const defaultVoiceIds = ["us_female", "uk_female", "au_male"];

export function listVoices() {
  return Object.values(voicePresets).map(({ speaker, resourceId, fallbacks, ...publicVoice }) => publicVoice);
}

export function resolveVoiceIds(voiceIds) {
  const selectedIds = Array.isArray(voiceIds) && voiceIds.length > 0 ? voiceIds : defaultVoiceIds;
  return selectedIds.map((voiceId) => {
    const voice = voicePresets[voiceId];
    if (!voice) {
      throw new Error(`Unsupported voice preset: ${voiceId}`);
    }
    return voice;
  });
}
