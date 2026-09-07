import type JSZip from "jszip";
import type {WorkBook} from "xlsx";
import {utils} from "xlsx";

const editable:Record<string,string[]>={"Program narrative":["B"],"Work elements":["B","C","D","E","F","G","H","I","L","M"],"Tasks and products":["D","E","F"],"Funding sources":["B","C","D","E","F","G","H","I","J","K","L"],"Allocations":["E","G"],"Expenditures":["D","E","F","I"],"Staffing":["E","F","G","H","I","J","K","L","M","N","O","P","Q","R","X"],"Indirect pools":["B","C","F"],"Mappings":["B","D"],"Source sections":["B","C","D","E"],"Amendments":["D","E"],"Conflicts":["B","C","D"]};
/** Add ordinary OpenXML styles/protection after SheetJS CE emits cells and formulas. */
export async function formatWorkProgramWorkbook(zip:JSZip,book:WorkBook) {
  const part=zip.file("xl/styles.xml");if(!part)throw new Error("Workbook styles missing");
  let xml=await part.async("string");
  const fonts=Number(xml.match(/<fonts count="(\d+)"/)?.[1]);
  const fills=Number(xml.match(/<fills count="(\d+)"/)?.[1]);
  const oldXfs=xml.match(/<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/)?.[1].match(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g);
  if(!Number.isInteger(fonts)||!Number.isInteger(fills)||!oldXfs?.length)throw new Error("Workbook style definitions invalid");
  xml=xml.replace(/<fonts count="\d+"/,`<fonts count="${fonts+3}"`).replace("</fonts>",`<font><sz val="11"/><color rgb="FF17323E"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><sz val="11"/><color rgb="FF0055A4"/><name val="Arial"/></font></fonts>`);
  xml=xml.replace(/<fills count="\d+"/,`<fills count="${fills+2}"`).replace("</fills>",'<fill><patternFill patternType="solid"><fgColor rgb="FF24515F"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF5FF"/><bgColor indexed="64"/></patternFill></fill></fills>');
  const styles=new Map<string,number>();const added:string[]=[];
  for(let base=0;base<oldXfs.length;base++)for(const kind of ["header","input","fixed"]){
    styles.set(`${base}:${kind}`,oldXfs.length+added.length);
    const numberFormat=oldXfs[base].match(/numFmtId="(\d+)"/)?.[1]??"0";
    added.push(`<xf numFmtId="${numberFormat}" fontId="${fonts+(kind==="header"?1:kind==="input"?2:0)}" fillId="${kind==="header"?fills:kind==="input"?fills+1:0}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1" applyProtection="1"><alignment vertical="top" wrapText="1"/><protection locked="${kind==="input"?0:1}"/></xf>`);
  }
  xml=xml.replace(/<cellXfs count="\d+">[\s\S]*?<\/cellXfs>/,`<cellXfs count="${oldXfs.length+added.length}">${oldXfs.join("")}${added.join("")}</cellXfs>`);
  zip.file("xl/styles.xml",xml);
  for(const [index,name] of book.SheetNames.entries()) {
    const sheet=book.Sheets[name],path=`xl/worksheets/sheet${index+1}.xml`,part=zip.file(path);if(!part)throw new Error("Worksheet missing");
    let data=await part.async("string");
    data=data.replace(/<c\b([^>]*\br="([A-Z]+)(\d+)"[^>]*)>/g,(_whole,attributes:string,column:string,row:string)=>{
      const cell=sheet[`${column}${row}`];const base=Number(attributes.match(/\bs="(\d+)"/)?.[1]??0);
      const kind=row==="1"?"header":!cell?.f&&editable[name]?.includes(column)?"input":"fixed";
      return `<c${attributes.replace(/\s+s="\d+"/,"")} s="${styles.get(`${base}:${kind}`)??styles.get(`0:${kind}`)}">`;
    });
    if (data.includes("<sheetPr")) data=data.replace(/<sheetPr([^>]*)\/>/, '<sheetPr$1></sheetPr>').replace(/<pageSetUpPr[^>]*\/>/g, "").replace('</sheetPr>','<pageSetUpPr fitToPage="1"/></sheetPr>');
    else data=data.replace(/(<worksheet[^>]*>)/, '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
    data=data.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/,'<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>');
    // Protect identity and formula cells without a password. Reviewers can deliberately unprotect.
    data=data.replace('</sheetData>','</sheetData><sheetProtection sheet="1" objects="1" scenarios="1" selectLockedCells="0" selectUnlockedCells="0" autoFilter="0"/>');
    if(!data.includes('<pageSetup'))data=data.replace('</worksheet>','<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="1" fitToWidth="1" fitToHeight="0"/></worksheet>');
    zip.file(path,data);
    // Guard against an emitter dropping styled/formula cells.
    for(const address of Object.keys(sheet).filter(key=>!key.startsWith("!")&&sheet[key].f))if(!data.includes(`r="${utils.encode_cell(utils.decode_cell(address))}"`))throw new Error("Formula cell missing from workbook");
  }
}
