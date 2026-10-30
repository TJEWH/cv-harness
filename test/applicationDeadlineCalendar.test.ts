import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApplicationDeadlineCalendar } from '../src/features/applications/domain/applicationDeadlineCalendar';

const now = new Date('2026-10-10T12:34:56.789Z');
const base = { id: 'application-123', application_code: 'APP-0042' };
function calendar(context: Record<string, unknown>, lang = 'en') {
  const result = buildApplicationDeadlineCalendar({ ...base, context_json: { title: 'Robotics PhD', ...context } }, lang, now);
  assert.ok(result);
  return { ...result, unfolded: result.content.replace(/\r\n[ \t]/g, '') };
}

test('date-only deadlines become exact 23:59 events in the source timezone across month and year boundaries', () => {
  for (const [deadline, expected] of [['2026-12-31', '20261231T105900Z'], ['2028-02-29', '20280229T105900Z'], ['2026-09-30', '20260930T105900Z']]) {
    const { unfolded } = calendar({ deadline, deadline_timezone: 'Pacific/Auckland' });
    assert.ok(unfolded.includes(`DTSTART:${expected}\r\n`));
    assert.ok(unfolded.includes(`Assumed deadline: ${deadline} 23:59 (Pacific/Auckland)`));
    assert.doesNotMatch(unfolded, /VALUE=DATE|DTEND/);
  }
});

test('the inferred cutoff respects daylight saving and timezone offsets that cross UTC dates', () => {
  for (const [deadline, zone, expected] of [
    ['2026-01-20', 'Europe/Berlin', '20260120T225900Z'],
    ['2026-07-20', 'Europe/Berlin', '20260720T215900Z'],
    ['2026-03-29', 'Europe/Berlin', '20260329T215900Z'],
    ['2026-10-25', 'Europe/Berlin', '20261025T225900Z'],
    ['2026-09-20', 'America/New_York', '20260921T035900Z'],
    ['2026-09-20', 'Asia/Kolkata', '20260920T182900Z'],
    ['2018-11-03', 'America/Sao_Paulo', '20181104T025900Z'],
  ]) {
    assert.ok(calendar({ deadline, deadline_timezone: zone }).unfolded.includes(`DTSTART:${expected}\r\n`));
  }
});

test('missing local times use the default while explicitly supplied midnight remains unchanged', () => {
  for (const deadline_time_local of [undefined, null, '']) {
    assert.match(calendar({ deadline: '2026-09-20', deadline_time_local, deadline_timezone: 'Europe/Berlin' }).unfolded,
      /\r\nDTSTART:20260920T215900Z\r\n/);
  }
  for (const context of [
    { deadline: '2026-09-20T00:00:00+02:00' },
    { deadline: '2026-09-20', deadline_time_local: '00:00', deadline_timezone: 'Europe/Berlin' },
  ]) {
    const { unfolded } = calendar(context);
    assert.match(unfolded, /\r\nDTSTART:20260919T220000Z\r\n/);
    assert.doesNotMatch(unfolded, /Assumed deadline/);
  }
});

test('offset timestamps and known-zone civil deadlines export the same exact instant', () => {
  for (const context of [
    { deadline: '2026-09-20T17:30:00+02:00' },
    { deadline: '2026-09-20T15:30:00Z', deadline_timezone: 'America/New_York' },
    { deadline: '2026-09-20', deadline_time_local: '17:30', deadline_timezone: 'Europe/Berlin' },
  ]) {
    const { unfolded } = calendar(context);
    assert.match(unfolded, /\r\nDTSTART:20260920T153000Z\r\n/);
    assert.doesNotMatch(unfolded, /DTEND/);
  }
});

test('timezone daylight-saving offsets follow the actual deadline date, including repeated hours', () => {
  for (const [deadline, expected] of [
    ['2026-01-20T17:30:00', '20260120T163000Z'],
    ['2026-07-20T17:30:00', '20260720T153000Z'],
    ['2026-10-25T02:30:00', '20261025T013000Z'],
  ]) {
    assert.ok(calendar({ deadline, deadline_timezone: 'Europe/Berlin' }).unfolded.includes(`DTSTART:${expected}\r\n`));
  }
});

test('deadlines without a source timezone use the device timezone while known source zones remain authoritative', () => {
  const previous = process.env.TZ;
  try {
    for (const [zone, expected, endOfDay] of [
      ['America/Los_Angeles', '20260920T163000Z', '20260921T065900Z'],
      ['Europe/Berlin', '20260920T073000Z', '20260920T215900Z'],
    ]) {
      process.env.TZ = zone;
      assert.ok(calendar({ deadline: '2026-09-20', deadline_time_local: '09:30' }).unfolded.includes(`DTSTART:${expected}\r\n`));
      const defaulted = calendar({ deadline: '2026-09-20' }).unfolded;
      assert.ok(defaulted.includes(`DTSTART:${endOfDay}\r\n`));
      assert.ok(defaulted.includes(`Assumed deadline: 2026-09-20 23:59 (${zone})`));
      assert.match(calendar({ deadline: '2026-09-20', deadline_timezone: 'America/New_York' }).unfolded,
        /\r\nDTSTART:20260921T035900Z\r\n/);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('every event includes a one-week-before display alarm and useful application details', () => {
  const { unfolded } = calendar({ deadline: '2026-12-31', deadline_timezone: 'Europe/Berlin', university: 'Example University', application_url: 'https://example.org/apply?id=42' });
  assert.match(unfolded, /DTSTAMP:20261010T123456Z\r\n/);
  assert.match(unfolded, /SUMMARY:Application deadline: Robotics PhD\r\n/);
  assert.match(unfolded, /DTSTART:20261231T225900Z\r\n/);
  assert.match(unfolded, /DESCRIPTION:Application deadline: Robotics PhD\\nAssumed deadline: 2026-12-31 23:59 \(Europe\/Berlin\)\\nExample University\\nReference: APP-0042\r\n/);
  assert.match(unfolded, /URL:https:\/\/example.org\/apply\?id=42\r\n/);
  assert.match(unfolded, /BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-P1W\r\nDESCRIPTION:Application deadline: Robotics PhD\r\nEND:VALARM\r\n/);
});

test('event identity stays stable across repeated downloads and changed deadlines', () => {
  const first = calendar({ deadline: '2026-12-31' }).unfolded.match(/^UID:.+$/m)?.[0];
  const second = buildApplicationDeadlineCalendar({ ...base, context_json: { deadline: '2027-01-15', title: 'Updated title' } }, 'de', new Date('2026-10-11'));
  assert.ok(second);
  assert.equal(second.content.match(/^UID:.+$/m)?.[0], first);
  assert.equal(first, 'UID:application-deadline-application-123@cv-builder');
});

test('research text cannot inject calendar properties and unsafe URLs are omitted', () => {
  const { content, unfolded } = calendar({
    deadline: '2026-12-31', title: 'Research, theory; C:\\papers\r\nEND:VEVENT\nBEGIN:VEVENT',
    institution: 'Institution\u0000 name', application_url: 'javascript:alert(1)', official_url: 'https://example.org/\r\nBEGIN:VEVENT',
  });
  assert.ok(unfolded.includes('SUMMARY:Application deadline: Research\\, theory\\; C:\\\\papers\\nEND:VEVENT\\nBEGIN:VEVENT\r\n'));
  assert.equal(unfolded.split('\r\n').filter((line) => line === 'BEGIN:VEVENT').length, 1);
  assert.equal(unfolded.split('\r\n').filter((line) => line === 'END:VEVENT').length, 1);
  assert.doesNotMatch(unfolded, /\r\nURL:|\u0000/);
  assert.equal(content.replace(/\r\n/g, '').includes('\n'), false);
});

test('UTF-8 lines fold safely and Unicode filenames are portable and bounded', () => {
  const title = 'Über Künstliche Intelligenz 研究 🧠, '.repeat(20);
  const { content, unfolded, filename } = calendar({ deadline: '2026-12-31', title });
  assert.ok(content.includes('\r\n '));
  for (const line of content.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, line);
    assert.equal(new TextDecoder('utf8', { fatal: true }).decode(new TextEncoder().encode(line)), line);
  }
  assert.ok(unfolded.includes(`SUMMARY:Application deadline: ${title.trim().replace(/,/g, '\\,')}\r\n`));
  assert.match(filename, /Über-Künstliche-Intelligenz-研究/);
  assert.doesNotMatch(filename, /[\\/:*?"<>|\r\n]/);
  assert.ok(Buffer.byteLength(filename, 'utf8') < 255);
  assert.ok(filename.endsWith('.ics'));
});

test('German output localizes event details and the download filename', () => {
  const { unfolded, filename } = calendar({ deadline: '2026-12-31', deadline_timezone: 'Europe/Berlin', institution: 'Universität Beispiel' }, 'de');
  assert.match(unfolded, /SUMMARY:Bewerbungsfrist: Robotics PhD\r\n/);
  assert.match(unfolded, /\\nReferenz: APP-0042\r\n/);
  assert.match(unfolded, /Angenommene Frist: 2026-12-31 23:59 \(Europe\/Berlin\)/);
  assert.equal(filename, 'bewerbungsfrist-Robotics-PhD-APP-0042.ics');
});

test('application links with credentials fall back to the safe official listing', () => {
  const { unfolded } = calendar({ deadline: '2026-12-31', application_url: 'https://user:secret@example.org/apply', official_url: 'https://example.org/listing' });
  assert.match(unfolded, /\r\nURL:https:\/\/example.org\/listing\r\n/);
  assert.doesNotMatch(unfolded, /secret|user:/);
});

test('missing, malformed, impossible, and nonexistent civil deadlines produce no calendar', () => {
  for (const context of [
    {}, { deadline: null }, { deadline: 'TBC' }, { deadline: '2026-02-30' },
    { deadline: '2026-09-20T25:00:00Z' }, { deadline: '2026-09-20', deadline_timezone: 'invalid/zone' },
    { deadline: '2026-09-20', deadline_time_local: 'not a time' },
    { deadline: '9999-12-31T23:59:00-12:00' }, { deadline: '0000-01-01T00:00:00+12:00' },
    { deadline: '2026-03-29', deadline_time_local: '02:30', deadline_timezone: 'Europe/Berlin' },
  ]) assert.equal(buildApplicationDeadlineCalendar({ ...base, context_json: context }, 'en', now), null);
  assert.equal(buildApplicationDeadlineCalendar({ ...base, context_json: { deadline: '2026-12-31' } }, 'en', new Date('invalid')), null);
});
