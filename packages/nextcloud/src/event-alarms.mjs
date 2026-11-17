import ICAL from 'ical.js';

function simpleMinutes(alarm) {
  const properties = alarm.getAllProperties();
  if (alarm.getAllSubcomponents().length || properties.some(property => !['action', 'trigger', 'description'].includes(property.name))) return null;
  if (['action', 'trigger', 'description'].some(name => alarm.getAllProperties(name).length !== 1)) return null;
  const action = alarm.getFirstProperty('action'), trigger = alarm.getFirstProperty('trigger');
  if (action.getFirstValue() !== 'DISPLAY' || trigger.type !== 'duration') return null;
  for (const property of properties) {
    const parameters = property.toJSON()[1];
    if (Object.keys(parameters).some(name => property.name !== 'trigger' || name !== 'related' || parameters[name] !== 'START')) return null;
  }
  const seconds = trigger.getFirstValue()?.toSeconds?.();
  return Number.isFinite(seconds) && seconds <= 0 && seconds >= -40320 * 60 && seconds % 60 === 0 ? -seconds / 60 || 0 : null;
}

function classify(event) {
  const alarms = event.getAllSubcomponents('valarm').map(alarm => {
    let minutes = null;
    try { minutes = simpleMinutes(alarm); } catch { /* Preserve malformed/unknown native alarms. */ }
    return {alarm, minutes};
  });
  const reminders = [...new Set(alarms.filter(item => item.minutes !== null).map(item => item.minutes))].sort((left, right) => left - right).slice(0, 5);
  return {alarms, reminders};
}

export function eventAlarmDetails(event) {
  const {alarms, reminders} = classify(event);
  return {reminders, unsupportedReminderCount: alarms.filter(item => item.minutes === null || !reminders.includes(item.minutes)).length};
}

/** Explicit edits affect only the five supported offsets. Other native alarms survive. */
export function replaceEventReminders(event, requested, title) {
  const {alarms, reminders} = classify(event);
  for (const item of alarms) if (item.minutes !== null && reminders.includes(item.minutes) && !requested.includes(item.minutes)) event.removeSubcomponent(item.alarm);
  for (const minutes of requested) {
    // An existing extra simple alarm at this offset is already preserved.
    if (alarms.some(item => item.minutes === minutes)) continue;
    const alarm = new ICAL.Component('valarm');
    alarm.addPropertyWithValue('action', 'DISPLAY');
    alarm.addPropertyWithValue('trigger', ICAL.Duration.fromSeconds(-minutes * 60));
    alarm.addPropertyWithValue('description', title);
    event.addSubcomponent(alarm);
  }
}
