import type { BookingTheme, parsePublicPatientFields } from '@cita-suite/shared/booking-integration';

export type PublicInformation = {
 documents_enabled?:boolean;
  theme: BookingTheme;
  schema: ReturnType<typeof parsePublicPatientFields>;
  schema_hash: string; answers: Record<string, string | boolean>; comment: string; version: string;
};

export type PublicInformationPageData = {
 info: PublicInformation; token: string; requestKey: string; managementUrl: string; documentsUrl: string;
 /** The practice, for the tab title. Absent when it could not be read. */
 businessName?: string | null;
};
export type PublicInformationFeedback = {
 saved: boolean; message: string;
 submitted?: { answers: Record<string,string | boolean>; comment: string; requestKey: string; schemaHash: string; version: string };
};
