import {describe,expect,it,vi} from 'vitest';
import {replaceProfessionalScheduleBlocks} from './availability-rules';
const blocks=[{weekdays:[2],ranges:[{start:'14:00',end:'17:00'}],slotIntervalMinutes:30,breakMinutes:0},{weekdays:[2],ranges:[{start:'17:00',end:'19:00'}],slotIntervalMinutes:30,breakMinutes:15,serviceScope:'restricted' as const,allowedServiceIds:['follow-up-id']}];
describe('atomic schedule replacement boundary',()=>{
 it('submits the complete draft and restrictions in one transaction without client-side deletion',async()=>{
  const rpc=vi.fn().mockResolvedValue({error:null});const from=vi.fn();
  await replaceProfessionalScheduleBlocks({rpc,from} as never,{businessId:'biz-1',professionalId:'pro-1',expectedRevision:7,blocks});
  expect(rpc).toHaveBeenCalledOnce();expect(from).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith('replace_professional_schedule_blocks',expect.objectContaining({p_business_id:'biz-1',p_professional_id:'pro-1',p_expected_revision:7,p_blocks:[expect.objectContaining({service_scope:'all',service_ids:[]}),expect.objectContaining({service_scope:'restricted',service_ids:['follow-up-id']})]}));
 });
 it('does not fall back to deleting rules when the atomic operation fails',async()=>{
  const cause={message:'SCHEDULE_CHANGED'};const rpc=vi.fn().mockResolvedValue({error:cause});const from=vi.fn();
  await expect(replaceProfessionalScheduleBlocks({rpc,from} as never,{businessId:'biz-1',professionalId:'pro-1',expectedRevision:7,blocks})).rejects.toEqual(cause);
  expect(from).not.toHaveBeenCalled();
 });
});
