// Structurally valid minimal .docx / .xlsx / .pptx packages, each embedding the
// same set of images, used as fixtures for the OXIC tests.
import { makeZip } from './zip.mjs';

const NS = {
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
};
// The relationships *markup* lives in the package namespace; relationship
// *types* are named under the officeDocument namespace. They are not the same URI.
const PKG_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const enc = s => Buffer.from(XML + s, 'utf8');

const rels = items => enc(
  `<Relationships xmlns="${PKG_RELS}">` +
  items.map(([id, type, target]) =>
    `<Relationship Id="${id}" Type="${REL_TYPE}/${type}" Target="${target}"/>`).join('') +
  `</Relationships>`);

const contentTypes = (defaults, overrides) => enc(
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  defaults.map(([e, t]) => `<Default Extension="${e}" ContentType="${t}"/>`).join('') +
  overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('') +
  `</Types>`);

const EXT_TYPE = { jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp' };
const extOf = n => n.split('.').pop().toLowerCase();

/** A DrawingML <pic:pic>, shared by all three formats. */
const pic = (id, rId, cx, cy) =>
  `<pic:pic xmlns:pic="${NS.pic}"><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/>` +
  `<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/>` +
  `<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm>` +
  `<a:off x="0" y="${(id - 1) * cy}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
  `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`;

/** Images arrive as [{name, data}] and land in <prefix>/media/. */
function mediaParts(prefix, images) {
  return images.map((img, i) => ({ name: `${prefix}/media/${img.name}`, data: img.data, rId: `rId${i + 1}` }));
}

function imageDefaults(images) {
  return [...new Set(images.map(i => extOf(i.name)))].map(e => [e, EXT_TYPE[e]]);
}

export function makeDocx(images) {
  const media = mediaParts('word', images);
  const body = media.map((m, i) =>
    `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="5486400" cy="3657600"/><wp:docPr id="${i + 1}" name="Picture ${i + 1}"/>` +
    `<a:graphic xmlns:a="${NS.a}"><a:graphicData uri="${NS.pic}">${pic(i + 1, m.rId, 5486400, 3657600)}` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`).join('');

  return makeZip([
    { name: '[Content_Types].xml', data: contentTypes(
        [['rels', 'application/vnd.openxmlformats-package.relationships+xml'], ...imageDefaults(images)],
        [['/word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml']]) },
    { name: '_rels/.rels', data: rels([['rId1', 'officeDocument', 'word/document.xml']]) },
    { name: 'word/document.xml', data: enc(
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
        `xmlns:r="${NS.r}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
        `<w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`) },
    { name: 'word/_rels/document.xml.rels', data: rels(
        media.map(m => [m.rId, 'image', `media/${m.name.split('/').pop()}`])) },
    ...media.map(m => ({ name: m.name, data: m.data })),
  ]);
}

export function makeXlsx(images) {
  const media = mediaParts('xl', images);
  const anchors = media.map((m, i) =>
    `<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff>` +
    `<xdr:row>${i * 20}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:ext cx="5486400" cy="3657600"/>${pic(i + 1, m.rId, 5486400, 3657600)}` +
    `<xdr:clientData/></xdr:oneCellAnchor>`).join('');

  return makeZip([
    { name: '[Content_Types].xml', data: contentTypes(
        [['rels', 'application/vnd.openxmlformats-package.relationships+xml'], ...imageDefaults(images)],
        [['/xl/workbook.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'],
         ['/xl/worksheets/sheet1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'],
         ['/xl/drawings/drawing1.xml', 'application/vnd.openxmlformats-officedocument.drawing+xml']]) },
    { name: '_rels/.rels', data: rels([['rId1', 'officeDocument', 'xl/workbook.xml']]) },
    { name: 'xl/workbook.xml', data: enc(
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS.r}">` +
        `<sheets><sheet name="Images" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: rels([['rId1', 'worksheet', 'worksheets/sheet1.xml']]) },
    { name: 'xl/worksheets/sheet1.xml', data: enc(
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS.r}">` +
        `<sheetData/><drawing r:id="rId1"/></worksheet>`) },
    { name: 'xl/worksheets/_rels/sheet1.xml.rels', data: rels([['rId1', 'drawing', '../drawings/drawing1.xml']]) },
    { name: 'xl/drawings/drawing1.xml', data: enc(
        `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ` +
        `xmlns:a="${NS.a}" xmlns:r="${NS.r}">${anchors}</xdr:wsDr>`) },
    // Targets here use ../media/, exercising relative-path resolution on rename.
    { name: 'xl/drawings/_rels/drawing1.xml.rels', data: rels(
        media.map(m => [m.rId, 'image', `../media/${m.name.split('/').pop()}`])) },
    ...media.map(m => ({ name: m.name, data: m.data })),
  ]);
}

export function makePptx(images) {
  const media = mediaParts('ppt', images);
  const shapes = media.map((m, i) =>
    `<p:pic><p:nvPicPr><p:cNvPr id="${i + 2}" name="Picture ${i + 1}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${m.rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="${i * 1000000}" y="0"/><a:ext cx="4000000" cy="3000000"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`).join('');

  const spTree = inner =>
    `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr/>${inner}</p:spTree></p:cSld>`;
  const P = `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="${NS.a}" xmlns:r="${NS.r}"`;

  return makeZip([
    { name: '[Content_Types].xml', data: contentTypes(
        [['rels', 'application/vnd.openxmlformats-package.relationships+xml'], ...imageDefaults(images)],
        [['/ppt/presentation.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'],
         ['/ppt/slides/slide1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'],
         ['/ppt/slideLayouts/slideLayout1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml'],
         ['/ppt/slideMasters/slideMaster1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml'],
         ['/ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml']]) },
    { name: '_rels/.rels', data: rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]) },
    { name: 'ppt/presentation.xml', data: enc(
        `<p:presentation ${P}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
        `<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>` +
        `<p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`) },
    { name: 'ppt/_rels/presentation.xml.rels', data: rels([
        ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
        ['rId2', 'slide', 'slides/slide1.xml']]) },
    { name: 'ppt/slides/slide1.xml', data: enc(`<p:sld ${P}>${spTree(shapes)}</p:sld>`) },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: rels([
        ['rIdL', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
        ...media.map(m => [m.rId, 'image', `../media/${m.name.split('/').pop()}`])]) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: enc(`<p:sldLayout ${P} type="blank">${spTree('')}</p:sldLayout>`) },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels([
        ['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: enc(
        `<p:sldMaster ${P}>${spTree('')}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`) },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels([
        ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
        ['rId2', 'theme', '../theme/theme1.xml']]) },
    { name: 'ppt/theme/theme1.xml', data: enc(
        `<a:theme xmlns:a="${NS.a}" name="OXIC"><a:themeElements>` +
        `<a:clrScheme name="OXIC"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>` +
        `<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
        `<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>` +
        `<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>` +
        `<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>` +
        `<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>` +
        `<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>` +
        `<a:fontScheme name="OXIC"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
        `<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
        `<a:fmtScheme name="OXIC"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
        `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>` +
        `<a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>` +
        `<a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>` +
        `<a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>` +
        `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>` +
        `<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
        `<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
        `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
        `</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`) },
    ...media.map(m => ({ name: m.name, data: m.data })),
  ]);
}
