import Image from 'next/image';
import { z } from 'zod';
const filesSchema=z.object({files:z.array(z.object({path:z.string(),original_name:z.string().optional()}))});
/** Display only authenticated app URLs, including restricted historical originals. */
export function SurveyReviewAttachments({campaignId,sessionId,answerId,value,historyId}:{campaignId:string;sessionId:string;answerId:string;value:unknown;historyId?:string}) {
 const parsed=filesSchema.safeParse(value);if(!parsed.success)return null;
 return <div className="space-y-3">{parsed.data.files.map((file,index)=>{const href=`/api/engagement/campaigns/${campaignId}/attachments?sessionId=${sessionId}&answerId=${answerId}&index=${index}${historyId?`&historyId=${historyId}`:''}`;return <figure key={index}><a href={href} target="_blank" rel="noreferrer" className="underline"><Image unoptimized src={href} alt={`Review attachment ${index+1}`} width={480} height={320} className="h-auto max-h-80 w-auto max-w-full object-contain"/>{file.original_name||`Open attachment ${index+1}`}</a></figure>;})}</div>;
}

export function SurveyHistoricalAttachments({campaignId,sessionId,historyId,value}:{campaignId:string;sessionId:string;historyId:string;value:unknown}) {
 const parsed=z.object({answers:z.array(z.object({id:z.string(),answer_json:z.unknown()}))}).safeParse(value);if(!parsed.success)return null;
 return <>{parsed.data.answers.map(answer=><SurveyReviewAttachments key={answer.id} campaignId={campaignId} sessionId={sessionId} historyId={historyId} answerId={answer.id} value={answer.answer_json}/>)}</>;
}
