export function getCurrencyOptionsForCountry(country: 'India' | 'Canada'): Array<'CAD' | 'INR' | 'USD'> {
  return country === 'Canada' ? ['CAD', 'USD'] : ['INR'];
}

export function getDefaultCurrencyForCountry(
  country: 'India' | 'Canada',
  existing?: 'CAD' | 'INR' | 'USD',
): 'CAD' | 'INR' | 'USD' {
  const allowedCurrencies: Array<'CAD' | 'INR' | 'USD'> = getCurrencyOptionsForCountry(country);
  if (existing && allowedCurrencies.includes(existing)) {
    return existing;
  }
  return country === 'Canada' ? 'CAD' : 'INR';
}
