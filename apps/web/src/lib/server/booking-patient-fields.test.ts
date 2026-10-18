import { describe, expect, it } from 'vitest';
import { parseBookingIntakeFields, parsePublicPatientFields, validateBookingIntakeAnswers } from '@cita-suite/shared/booking-integration';
import { intakeAnswersFromForm } from '$lib/server/sites/public/booking-integrations';
const field = {id:'profile_insurance', label:'Obra social', kind:'text', required:true, maxLength:120, patientField:'insurance'};
describe('professional patient declarations', () => {
 it('requires a mapped answer and rejects invented keys, retaining optional omission', () => {
   const schema = parsePublicPatientFields([field, {id:'profile_medication',label:'Medicación',kind:'textarea',required:false,maxLength:1000,patientField:'medication'}]);
   expect(() => validateBookingIntakeAnswers(schema,{})).toThrow('BOOKING_INTAKE_REQUIRED');
   expect(validateBookingIntakeAnswers(schema,{profile_insurance:' Particular '})).toEqual({profile_insurance:'Particular'});
   expect(() => validateBookingIntakeAnswers(schema,{profile_insurance:'Particular',invented:'x'})).toThrow('BOOKING_INTAKE_ANSWERS_INVALID');
 });
 it('decodes false as an actual declaration, not a missing answer', () => {
   const intakeFields = parsePublicPatientFields([{id:'prof_flag',label:'Dato',kind:'boolean',required:true,patientField:'custom'}]);
   const form = new FormData(); form.set('intake_prof_flag','false');
   expect(intakeAnswersFromForm({intakeFields},form)).toEqual({prof_flag:false});
   form.append('intake_prof_flag','true'); expect(() => intakeAnswersFromForm({intakeFields},form)).toThrow('BOOKING_INTAKE_ANSWERS_INVALID');
 });
 it('handles merged teams above the individual limit without duplicate identifiers', () => {
   const fields = Array.from({length:40},(_,i) => ({...field,id:'prof_' + i,patientField:'custom'}));
   expect(parsePublicPatientFields(fields)).toHaveLength(40);
   expect(() => parseBookingIntakeFields(fields)).toThrow('BOOKING_INTAKE_SCHEMA_INVALID');
   fields[39].id=fields[0].id; expect(() => parsePublicPatientFields(fields)).toThrow('BOOKING_INTAKE_SCHEMA_INVALID');
 });
 it('rejects unsupported mappings, hidden schema properties and unsuitable date/age types', () => {
   for (const invalid of [{...field,patientField:'salary'},{...field,hidden:true},{...field,patientField:'age',kind:'choice',maxLength:undefined,options:['35']}]) {
     expect(() => parseBookingIntakeFields([invalid])).toThrow('BOOKING_INTAKE_SCHEMA_INVALID');
   }
 });
});
