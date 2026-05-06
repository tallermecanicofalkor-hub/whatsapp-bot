const calendarService = require('./calendar.service');

async function bookAppointment(conv) {
  const { selectedSlot, durationHours } = conv.data;

  const available = await calendarService.validateSlotAvailability(
    selectedSlot.startISO,
    durationHours,
  );

  if (!available) {
    const err = new Error('Slot taken');
    err.code = 'SLOT_TAKEN';
    throw err;
  }

  const event = await calendarService.createAppointmentEvent({
    name: conv.data.name,
    phone: conv.phone,
    vehicle: conv.data.vehicle,
    problemDescription: conv.data.problemDescription,
    durationHours,
    complexity: conv.data.complexity,
    canMove: conv.data.canMove,
    startISO: selectedSlot.startISO,
    messages: conv.messages,
  });

  return event;
}

module.exports = { bookAppointment };
