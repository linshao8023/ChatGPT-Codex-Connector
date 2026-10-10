// Shared D1/R2 image plumbing for the public research-code library.
// R2 remains private: images are served only after the D1 code is approved.
export const MAX_CODE_IMAGES=1;
export const MAX_CODE_IMAGE_BYTES=1048576; // 1 MiB per image
export const MAX_CODE_POST_BYTES=2097152; // one 1 MiB image + multipart overhead
const ACCEPTED={
  "image/png":{ext:"png"},
  "image/jpeg":{ext:"jpg"},
  "image/webp":{ext:"webp"}
};
const CREATE_IMAGES="CREATE TABLE IF NOT EXISTS code_share_images ("+
  "id TEXT PRIMARY KEY,"+
  "code_id INTEGER NOT NULL REFERENCES code_shares(id) ON DELETE CASCADE,"+
  "object_key TEXT NOT NULL UNIQUE,"+
  "mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/webp')),"+
  "size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 1048576),"+
  "position INTEGER NOT NULL CHECK (position = 0),"+
  "created_at TEXT NOT NULL DEFAULT (datetime('now'))"+
")";

export async function ensureImageTable(db){
  await db.prepare(CREATE_IMAGES).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_code_share_images_code ON code_share_images(code_id,position)").run();
}

export const imageBucket=env=>{
  const bucket=env?.CODE_IMAGES;
  return bucket&&typeof bucket.get==="function"&&typeof bucket.put==="function"&&typeof bucket.delete==="function"?bucket:null;
};
export class ImageUploadError extends Error{
  constructor(message,status=400){super(message);this.status=status;}
}
function detectedMime(bytes){
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((value,i)=>bytes[i]===value))return "image/png";
  if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return "image/jpeg";
  if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP")return "image/webp";
  return "";
}

export async function validateImageUploads(files){
  if(!Array.isArray(files)||files.length>MAX_CODE_IMAGES){
    throw new ImageUploadError("每条代码最多上传 1 张样图");
  }
  const images=[];
  for(const file of files){
    if(!file||typeof file.size!=="number"||typeof file.arrayBuffer!=="function"||typeof file.slice!=="function"){
      throw new ImageUploadError("图片表单格式无效");
    }
    if(file.size<1||file.size>MAX_CODE_IMAGE_BYTES){
      throw new ImageUploadError("每张样图必须小于等于 1 MB");
    }
    const mime=detectedMime(new Uint8Array(await file.slice(0,16).arrayBuffer()));
    if(!ACCEPTED[mime]||(file.type&&file.type.toLowerCase()!==mime)){
      throw new ImageUploadError("仅支持真实的 PNG、JPG、WebP 图片，不接受伪装文件");
    }
    const id=crypto.randomUUID().replace(/-/g,"");
    images.push({
      id,key:"code-images/"+id+"."+ACCEPTED[mime].ext,
      mime,size:file.size,file
    });
  }
  return images;
}

export async function deleteR2Images(bucket,images){
  if(!bucket||!images?.length)return;
  for(const image of images){
    try{await bucket.delete(image.key||image.object_key);}
    catch(error){console.warn("Code sample cleanup failed",error);}
  }
}
