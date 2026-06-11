import "dotenv/config";
import "cheerio";
import { Document } from "@langchain/core/documents";
import { LatexTextSplitter } from "@langchain/textsplitters";

const latexText = `\int x^{\mu}\mathrm{d}x=\frac{x^{\mu +1}}{\mu +1}+C, \left({\mu \neq -1}\right) \int \frac{1}{\sqrt{1-x^{2}}}\mathrm{d}x= \arcsin x +C \int \frac{1}{\sqrt{1-x^{2}}}\mathrm{d}x= \arcsin x +C \begin{pmatrix}  
  a_{11} & a_{12} & a_{13} \\  
  a_{21} & a_{22} & a_{23} \\  
  a_{31} & a_{32} & a_{33}  
\end{pmatrix} `;

const latexDoc = new Document({
  pageContent: latexText,
});

const markdownTextSplitter = new LatexTextSplitter({
  chunkSize: 200,
  chunkOverlap: 40,
});

const splitDocuments = await markdownTextSplitter.splitDocuments([latexDoc]);

// console.log(splitDocuments);

splitDocuments.forEach((document) => {
  console.log(document);
  console.log("charater length:", document.pageContent.length);
});

// 也是按照正确的语法分割的。

// Document {
//   pageContent: 'int x^{mu}mathrm{d}x=\frac{x^{mu +1}}{mu +1}+C, left({mu \n' +
//     'eq -1}\right) int \frac{1}{sqrt{1-x^{2}}}mathrm{d}x= arcsin x +C int \frac{1}{sqrt{1-x^{2}}}mathrm{d}x= arcsin x
// +C \begin{pmatrix}',
//   metadata: { loc: { lines: [Object] } },
//   id: undefined
// }
// charater length: 184
// Document {
//   pageContent: 'a_{11} & a_{12} & a_{13} \\  \n' +
//     '  a_{21} & a_{22} & a_{23} \\  \n' +
//     '  a_{31} & a_{32} & a_{33}  \n' +
//     'end{pmatrix}',
//   metadata: { loc: { lines: [Object] } },
//   id: undefined
// }
// charater length: 101
