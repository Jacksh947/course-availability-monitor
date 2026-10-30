const integerFields = ['class_capacity', 'enrolment_total', 'available_seats', 'waitlist_capacity', 'waitlist_total'];

export function validateSnapshot(input, target) {
  for (const key of ['course', 'term', 'class_number']) {
    if (String(input[key]).replace(/\s+/g, ' ').trim() !== String(target[key]).replace(/\s+/g, ' ').trim()) {
      throw new Error('target_not_verified');
    }
  }
  const result = { ...input };
  for (const key of integerFields) {
    if (!/^\d+$/.test(String(input[key]))) throw new Error('invalid_availability');
    result[key] = Number(input[key]);
    if (!Number.isSafeInteger(result[key])) throw new Error('invalid_availability');
  }
  if (!['closed', 'waitlist', 'open'].includes(String(input.status).toLowerCase().trim())) {
    throw new Error('unrecognized_status');
  }
  result.status = input.status.toLowerCase().trim();
  result.waitlist_spaces = Math.max(0, result.waitlist_capacity - result.waitlist_total);
  return result;
}

export function signal(snapshot) {
  return {
    waitlist: snapshot.waitlist_spaces > 0 || snapshot.status === 'waitlist',
    seats: snapshot.available_seats > 0 || snapshot.status === 'open',
    waitlist_spaces: snapshot.waitlist_spaces,
    available_seats: snapshot.available_seats,
    class_capacity: snapshot.class_capacity,
    waitlist_capacity: snapshot.waitlist_capacity
  };
}

export function changes(previous, current) {
  const now = signal(current);
  const before = previous ? signal(previous) : null;
  const events = [];
  if (now.waitlist && (!before?.waitlist || now.waitlist_spaces > before.waitlist_spaces)) events.push('waitlist_available');
  if (now.seats && (!before?.seats || now.available_seats > before.available_seats)) events.push('seats_reported_available');
  if (before && now.class_capacity > before.class_capacity) events.push('class_capacity_increased');
  if (before && now.waitlist_capacity > before.waitlist_capacity) events.push('waitlist_capacity_increased');
  return events;
}
