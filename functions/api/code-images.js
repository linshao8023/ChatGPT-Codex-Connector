import {respond,database,sourceAllowed,publicationCodeMatches,publicationCodeConfigured} from "../_lib/community.js";
import {imageBucket,ensureImageTable,validateImageUploads,deleteR2Images,ImageUploadError,MAX_CODE_POST_BYTES} from "../_lib/code-images.js";

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
      "SELECT id,mime_type,size_bytes,position FROM code_share_images WHERE code_id=? ORDER BY position ASC,id ASC LIMIT 1"
    ).bind(codeId).all();
    return respond({ok:true,code_id:codeId,images:(found.results||[]).map(item=>({
      id:item.id,type:item.mime_type,size_bytes:item.size_bytes,url:"/api/code-images?image_id="+item.id
    }))});
  }catch(error){
    console.error("Code sample images could not be read",error);
    return respond({ok:false,error:"样图暂不可用，请站长检查 D1 / CODE_IMAGES R2 绑定"},503);
  }
}


export async function onRequestPost({request,env}){
 if(!sourceAllowed(request))return respond({ok:false,error:"不允许跨站上传"},403);
 if(!publicationCodeConfigured(env))return respond({ok:false,error:"未配置统一发布暗号 Secret"},503);
 const db=database(env),bucket=imageBucket(env);
 if(!db)return respond({ok:false,error:"D1 数据库未绑定"},503);
 if(!bucket)return respond({ok:false,error:"站长尚未绑定 R2 存储桶 CODE_IMAGES"},503);
 if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("multipart/form-data")){
   return respond({ok:false,error:"请使用图片上传表单"},415);
 }
 if(Number(request.headers.get("Content-Length")||0)>MAX_CODE_POST_BYTES)return respond({ok:false,error:"样图上传包超过 2 MB"},413);
 let uploaded=[];
 try{
  const form=await request.formData();
  const id=validId(form.get("code_id"));
  if(!id)return respond({ok:false,error:"代码编号无效"},400);
  if(!publicationCodeMatches(env,form.get("approval_code")))return respond({ok:false,error:"发布暗号不正确，样图未保存"},403);
  const images=await validateImageUploads(form.getAll("images"));
  // Missing images means clear old images, otherwise replace all images.
  await ensureImageTable(db);
  const owner=await db.prepare("SELECT id FROM code_shares WHERE id=? AND status='approved'").bind(id).first();
  if(!owner)return respond({ok:false,error:"代码不存在或已下架"},404);
  const previous=await db.prepare("SELECT id,object_key FROM code_share_images WHERE code_id=?").bind(id).all();
  for(const img of images){
    await bucket.put(img.key,img.file.stream(),{
      httpMetadata:{contentType:img.mime},
      customMetadata:{codeId:String(id)}
    });
    uploaded.push(img);
  }
  // A transactional D1 batch switches metadata only after ALL R2 puts succeed.
  const stmts=[db.prepare("DELETE FROM code_share_images WHERE code_id=?").bind(id)];
  for(let i=0;i<images.length;i++){
    const img=images[i];
    stmts.push(db.prepare(
      "INSERT INTO code_share_images(id,code_id,object_key,mime_type,size_bytes,position) VALUES(?,?,?,?,?,?)"
    ).bind(img.id,id,img.key,img.mime,img.size,i));
  }
  await db.batch(stmts);
  await deleteR2Images(bucket,previous.results||[]);
  return respond({ok:true,code_id:id,count:images.length,message:images.length?"样图上传成功，旧样图已替换。":"已清除该代码的全部样图。"});
 }catch(error){
  await deleteR2Images(bucket,uploaded);
  if(error instanceof ImageUploadError)return respond({ok:false,error:error.message},error.status);
  console.error("Code sample image upload failed",error);
  return respond({ok:false,error:"样图保存失败；代码投稿不受影响。请检查 R2 绑定和 D1 日志。"},503);
 }
}
