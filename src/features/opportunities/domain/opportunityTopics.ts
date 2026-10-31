/** Formatting equivalence only. Related meanings remain distinct topic identities. */
const technicalNames = new Map(Object.entries({
  ai: 'AI', ml: 'ML', dl: 'DL', nlp: 'NLP', llm: 'LLM', llms: 'LLMs', hri: 'HRI', hci: 'HCI', bci: 'BCI',
  eeg: 'EEG', emg: 'EMG', fmri: 'fMRI', mri: 'MRI', mems: 'MEMS', cmos: 'CMOS', fpga: 'FPGA', asic: 'ASIC',
  dsp: 'DSP', rf: 'RF', rfid: 'RFID', iot: 'IoT', iiot: 'IIoT', ros: 'ROS', ros2: 'ROS2', slam: 'SLAM',
  ar: 'AR', vr: 'VR', xr: 'XR', ux: 'UX', ui: 'UI', cad: 'CAD', cae: 'CAE', cfd: 'CFD', fem: 'FEM',
  cpu: 'CPU', gpu: 'GPU', tpu: 'TPU', api: 'API', dna: 'DNA', rna: 'RNA', led: 'LED', pcb: 'PCB',
  fft: 'FFT', stft: 'STFT', fir: 'FIR', iir: 'IIR', doa: 'DOA', tdoa: 'TDOA', hrtf: 'HRTF',
  '2d': '2D', '3d': '3D', '4d': '4D', lidar: 'LiDAR', 'r&d': 'R&D', 'c++': 'C++',
  python: 'Python', matlab: 'MATLAB', javascript: 'JavaScript', typescript: 'TypeScript', linux: 'Linux',
  ios: 'iOS', android: 'Android', openai: 'OpenAI', phd: 'PhD',
}));

export const OPPORTUNITY_TOPIC_FORMAT_RULE = 'TOPIC FORMAT: Create short English natural-language topic labels using spaces, never underscores. Use sentence case consistently, preserving established technical acronyms and names such as AI, HRI, 3D and Python (for example, "Acoustic sensing" and "Embedded AI"). Trim and collapse whitespace. Reuse the same canonical label for the same topic across opportunities; case, whitespace and underscore variants are duplicates, so include each topic only once per opportunity. Keep genuinely distinct topics distinct; do not broaden a label or infer topics unsupported by the advertised research.';

export function opportunityTopicKey(value: string): string {
  return value.normalize('NFKC').replace(/_+/gu, ' ').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en');
}

/** A label is derived from the key, so record order and input capitalization cannot choose its spelling. */
export function normalizeOpportunityTopic(value: string): { id: string; label: string } {
  const id = opportunityTopicKey(value);
  const words = id.split(' ').map(word => word.replace(/[\p{L}\p{N}]+(?:\+\+|&[\p{L}\p{N}]+)?/gu,
    token => technicalNames.get(token) ?? token));
  const firstWordHasTechnicalName = words[0] !== id.split(' ')[0];
  const label = words.join(' ').replace(/\p{L}/u, letter => firstWordHasTechnicalName ? letter : letter.toLocaleUpperCase('en'));
  return { id, label };
}

/** Does not mutate stored records or apply privacy policy; callers keep their own safety gates. */
export function normalizeOpportunityTopics(values: readonly string[]): string[] {
  const topics = new Map<string, string>();
  for (const value of values) {
    const topic = normalizeOpportunityTopic(value);
    if (topic.id) topics.set(topic.id, topic.label);
  }
  return [...topics.values()];
}
