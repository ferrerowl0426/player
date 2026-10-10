const fs=require("fs");
const data=fs.readFileSync("C:/Users/user/Desktop/播放器/outputs/测试账号密码表.pdf");
if (!data.slice(0,5).toString().startsWith("%PDF-")) process.exit(1);
console.log("pdf_header_ok", data.slice(0,5).toString());
