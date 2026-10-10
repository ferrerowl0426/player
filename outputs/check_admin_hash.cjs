const fs=require("fs");
const bcrypt=require("C:/Users/user/Desktop/播放器/backend/node_modules/bcryptjs");
const h="$2b$10$Wg6YkgUtnWlAtaQrv/q55eYBXt8RR8HxO3iYxFbJW8hG7eAzITGwu";
const lines=[];
for (const p of ["admin","admin123","demo123","test1234","123456"]) lines.push(`${p} ${bcrypt.compareSync(p,h)}`);
fs.writeFileSync("C:/Users/user/Desktop/播放器/outputs/check_admin_hash.txt", lines.join("\n"));
