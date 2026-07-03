function isValidEthiopianPhone(phone) {
  if (typeof phone !== 'string') return false;
  const digits = phone.replace(/\D/g, '');
  return /^(2519|09)\d{8}$/.test(digits);
}

function isValidPositiveNumber(val) {
  return typeof val === 'number' && val > 0 && Number.isFinite(val);
}

module.exports = { isValidEthiopianPhone, isValidPositiveNumber };
