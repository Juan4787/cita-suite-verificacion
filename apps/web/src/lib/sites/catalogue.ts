import { BOOKING_MODALITIES } from '@cita-suite/shared/booking-integration';
import { InvalidDataContractError, readArray, readFiniteNumber, readNullableText, readRecord, readText } from '$lib/contracts/json';

export function parsePublicContact(value: unknown) {
  const row = readRecord(value, 'publicContact');
  return {
    phone: readNullableText(row.phone, 'publicContact.phone'),
    address: readNullableText(row.address, 'publicContact.address'),
    whatsapp_phone: readNullableText(row.whatsapp_phone, 'publicContact.whatsapp_phone'),
    whatsapp_message: readNullableText(row.whatsapp_message, 'publicContact.whatsapp_message')
  };
}

export function parsePublicContactResponse(value: unknown) {
  const row = readRecord(value, 'publicContactResponse');
  return {
    allowedOrigins: readArray(row.allowed_origins, 'publicContactResponse.allowedOrigins').map(origin => readText(origin, 'publicContactResponse.origin')),
    contact: parsePublicContact(row.contact)
  };
}

export function parsePublicCatalogue(value: unknown) {
  const row = readRecord(value, 'publicCatalogue');
  return {
    services: readArray(row.services, 'publicCatalogue.services').map(value => {
      const service = readRecord(value, 'publicCatalogue.service');
      const duration_minutes = readFiniteNumber(service.duration_minutes, 'publicCatalogue.service.duration');
      if (!Number.isSafeInteger(duration_minutes) || duration_minutes < 1) throw new InvalidDataContractError('publicCatalogue.service.duration');
      return {
        id: readText(service.id, 'publicCatalogue.service.id'), name: readText(service.name, 'publicCatalogue.service.name'),
        description: readNullableText(service.description, 'publicCatalogue.service.description'),
        price_label: readNullableText(service.price_label, 'publicCatalogue.service.priceLabel'), duration_minutes
      };
    }),
    modalities: readArray(row.modalities, 'publicCatalogue.modalities').map(value => {
      const modality = BOOKING_MODALITIES.find(candidate => candidate === value);
      if (!modality) throw new InvalidDataContractError('publicCatalogue.modality');
      return modality;
    }),
    contact: parsePublicContact(row.contact)
  };
}
