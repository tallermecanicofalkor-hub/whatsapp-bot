const conversations = new Map();

function getOrCreate(phone) {
  let conv = conversations.get(phone);
  if (!conv) {
    conv = {
      phone,
      step: 'START',
      status: 'active',
      data: {
        name: null,
        vehicleBrand: null,
        vehicleModel: null,
        vehicleYear: null,
        vehicle: null,
        problemDescription: null,
        canMove: null,
        preferredDate: null,
        preferredTimeOfDay: null,
        offeredSlots: [],
        selectedSlot: null,
        durationHours: null,
        complexity: null,
      },
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    conversations.set(phone, conv);
  }
  return conv;
}

function update(phone, patch) {
  const conv = getOrCreate(phone);
  Object.assign(conv, patch);
  conv.updatedAt = new Date();
  return conv;
}

function reset(phone) {
  conversations.delete(phone);
}

function addMessage(phone, from, text) {
  const conv = getOrCreate(phone);
  conv.messages.push({ from, text, at: new Date() });
  conv.updatedAt = new Date();
}

module.exports = { getOrCreate, update, reset, addMessage, _store: conversations };
