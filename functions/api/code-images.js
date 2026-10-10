import {respond,database} from "../_lib/community.js";
import {imageBucket,ensureImageTable} from "../_lib/code-images.js";

const validId=value=>{
  const id=Number(value);
  return Number.isSafeInteger(id)&&id>0?id:null;
};

export async function onRequestGet({env,request}){
  const db=database(env);
  if(!db)return respond({ok:false,error:"D1 数据库未绑定"},503);
  const params=new URL(request.url).searchParams;
  const imageId=params.get("image_id");
  const codeId=validId(params.get("code_id"));
  try{
    await ensureImageTable(db);
    if(imageId!==null){
      if(!/^[0-9a-f]{32}$/.test(imageId))return respond({ok:false,error:"样图编号无效"},400);
      const record=await db.prepare(
        "SELECT ci.object_key,ci.mime_type,ci.size_bytes FROM code_share_images ci "+
        "JOIN code_shares cs ON cs.id=ci.code_id "+
        "WHERE ci.id=? AND cs.status='approved'"
      ).bind(imageId).first();
      if(!record)return respond({ok:false,error:"样图不存在或已下架"},404);
      const bucket=imageBucket(env);
      if(!bucket)return respond({ok:false,error:"图片存储 R2 尚未绑定，请联系站长"},503);
      const object=await bucket.get(record.object_key);
      if(!object||!object.body)return respond({ok:false,error:"图片文件暂不可用"},404);
      const allowed=["image/png","image/jpeg","image/webp"];
      if(!allowed.includes(record.mime_type))return respond({ok:false,error:"不支持的样图格式"},415);
      return new Response(object.body,{
        status:200,
        headers:{
          "Content-Type":record.mime_type,
          "Content-Length":String(record.size_bytes),
          "Content-Disposition":"inline",
          "Cache-Control":"private, no-store",
          "X-Content-Type-Options":"nosniff",
          "Cross-Origin-Resource-Policy":"same-origin",
          "Referrer-Policy":"no-referrer"
        }
      });
    }
    if(!codeId)return respond({ok:false,error:"请提供有效的 code_id 或 image_id"},400);
    const published=await db.prepare("SELECT id FROM code_shares WHERE id=? AND status='approved'").bind(codeId).first();
    if(!published)return respond({ok:false,error:"代码不存在或未公开"},404);
    const found=await db.prepare(
      "SELECT id,mime_type,size_bytes,position FROM code_share_images WHERE code_id=? ORDER BY position ASC"
    ).bind(codeId).all();
    return respond({ok:true,code_id:codeId,images:(found.results||[]).map(item=>({
      id:item.id,type:item.mime_type,size_bytes:item.size_bytes,url:"/api/code-images?image_id="+item.id
    }))});
  }catch(error){
    console.error("Code sample images could not be read",error);
    return respond({ok:false,error:"样图暂不可用，请站长检查 D1 / CODE_IMAGES R2 绑定"},503);
  }
}
