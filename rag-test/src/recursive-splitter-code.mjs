import "dotenv/config";
import "cheerio";
import { Document } from "@langchain/core/documents";
import {
  LatexTextSplitter,
  RecursiveCharacterTextSplitter,
} from "@langchain/textsplitters";

const jsCode = `// Complete shopping cart implementation
class Product {
  constructor(id, name, price, description) {
    this.id = id;
    this.name = name;
    this.price = price;
    this.description = description;
  }

  getFormattedPrice() {
    return '$' + this.price.toFixed(2);
  }
}

class ShoppingCart {
  constructor() {
    this.items = [];
    this.discountCode = null;
    this.taxRate = 0.08;
  }

  addItem(product, quantity = 1) {
    const existingItem = this.items.find(item => item.product.id === product.id);
    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      this.items.push({ product, quantity, addedAt: new Date() });
    }
    return this;
  }

  removeItem(productId) {
    this.items = this.items.filter(item => item.product.id !== productId);
    return this;
  }

  calculateSubtotal() {
    return this.items.reduce((total, item) => {
      return total + (item.product.price * item.quantity);
    }, 0);
  }

  calculateTotal() {
    const subtotal = this.calculateSubtotal();
    const discount = this.calculateDiscount();
    const tax = (subtotal - discount) * this.taxRate;
    return subtotal - discount + tax;
  }

  calculateDiscount() {
    if (!this.discountCode) return 0;
    const discounts = { 'SAVE10': 0.10, 'SAVE20': 0.20, 'WELCOME': 0.15 };
    return this.calculateSubtotal() * (discounts[this.discountCode] || 0);
  }
}

// Usage example
const product1 = new Product(1, 'Laptop', 999.99, 'High-performance laptop');
const product2 = new Product(2, 'Mouse', 29.99, 'Wireless mouse');
const cart = new ShoppingCart();
cart.addItem(product1, 1).addItem(product2, 2);
console.log('Total:', cart.calculateTotal());`;

const jsCodeDoc = new Document({
  pageContent: jsCode,
});

const codeSplitter = RecursiveCharacterTextSplitter.fromLanguage("js", {
  chunkSize: 300,
  chunkOverlap: 60,
});

const splitDocuments = await codeSplitter.splitDocuments([jsCodeDoc]);
// console.log(splitDocuments);

splitDocuments.forEach((document) => {
  console.log(document);
  console.log("charater length:", document.pageContent.length);
});

// 用 RecursiveCharacterTextSplitter.fromLanguage 这个方法，指定语言，就会按照对应的语法来分割。
// 支持的语言有很多，包括： java、go、js、html、python、rust、swift、markdown 等

//可以看到，完全没有破坏代码完整性，确实是按照语法分割的。

// Document {
//   pageContent: '// Complete shopping cart implementation\n' +
//     'class Product {\n' +
//     '  constructor(id, name, price, description) {\n' +
//     '    this.id = id;\n' +
//     '    this.name = name;\n' +
//     '    this.price = price;\n' +
//     '    this.description = description;\n' +
//     '  }\n' +
//     '\n' +
//     '  getFormattedPrice() {\n' +
//     "    return '$' + this.price.toFixed(2);\n" +
//     '  }\n' +
//     '}',
//   metadata: { loc: { lines: [Object] } },
//   id: undefined
// }
// charater length: 277
// Document {
//   pageContent: 'class ShoppingCart {\n' +
//     '  constructor() {\n' +
//     '    this.items = [];\n' +
//     '    this.discountCode = null;\n' +
//     '    this.taxRate = 0.08;\n' +
//     '  }',
//   metadata: { loc: { lines: [Object] } },
//   id: undefined
// }
// charater length: 118
// Document {
//   pageContent: 'addItem(product, quantity = 1) {\n' +
//     '    const existingItem = this.items.find(item => item.product.id === product.id);\n' +
//     '    if (existingItem) {\n' +
//     '      existingItem.quantity += quantity;\n' +
//     '    } else {\n' +
//     '      this.items.push({ product, quantity, addedAt: new Date() });\n' +
//     '    }\n' +
//     '    return this;\n' +
//     '  }',
//   metadata: { loc: { lines: [Object] } },
//   id: undefined
// }
// charater length: 286
// Document {
//   pageContent: 'removeItem(productId) {\n' +
//     '    this.items = this.items.filter(item => item.product.id !== productId);\n' +
//     '    return this;\n' +
//     '  }\n' +
//     '\n' +
//     '  calculateSubtotal() {\n' +
//     '    return this.items.reduce((total, item) => {\n' +
//     '      return total + (item.product.price * item.quantity);\n' +
//     '    }, 0);\n' +
//     '  }',
//   metadata: { loc: { lines: [Object] } },
//   id: undefined
// }
// charater length: 266
// Document {
//   pageContent: 'calculateTotal() {\n' +
//     '    const subtotal = this.calculateSubtotal();\n' +
//     '    const discount = this.calculateDiscount();\n' +
//     '    const tax = (subtotal - discount) * this.taxRate;\n' +
//     '    return subtotal - discount + tax;\n' +
//     '  }',
//   metadata: { loc: { lines: [Object] } },
//   id: undefined
// }
// charater length: 208
// Document {
//   pageContent: 'calculateDiscount() {\n' +
//     '    if (!this.discountCode) return 0;\n' +
//     "    const discounts = { 'SAVE10': 0.10, 'SAVE20': 0.20, 'WELCOME': 0.15 };\n" +
//     '    return this.calculateSubtotal() * (discounts[this.discountCode] || 0);\n' +
//     '  }\n' +
//     '}\n' +
//     '\n' +
//     '// Usage example',
//   metadata: { loc: { lines: [Object] } },
//   id: undefined
// }
// charater length: 233
// Document {
//   pageContent: "const product1 = new Product(1, 'Laptop', 999.99, 'High-performance laptop');\n" +
//     "const product2 = new Product(2, 'Mouse', 29.99, 'Wireless mouse');\n" +
//     'const cart = new ShoppingCart();\n' +
//     'cart.addItem(product1, 1).addItem(product2, 2);\n' +
//     "console.log('Total:', cart.calculateTotal());",
//   metadata: { loc: { lines: [Object] } },
//   id: undefined
// }
// charater length: 271

//==============================================================
// 其实看到这里你应该也有答案了，基本就用 RecursiveCharacterTextSplitter 就行。
//==============================================================
