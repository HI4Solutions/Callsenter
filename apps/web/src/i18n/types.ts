// The Norwegian texts give the keys their types: t("login.title") is checked when it compiles.
import type { Locale } from "@veriqall/shared";
import type account from "../../messages/nb/account.json";
import type common from "../../messages/nb/common.json";
import type complaints from "../../messages/nb/complaints.json";
import type confirm from "../../messages/nb/confirm.json";
import type customers from "../../messages/nb/customers.json";
import type domain from "../../messages/nb/domain.json";
import type languages from "../../messages/nb/languages.json";
import type login from "../../messages/nb/login.json";
import type products from "../../messages/nb/products.json";
import type sales from "../../messages/nb/sales.json";
import type shell from "../../messages/nb/shell.json";
import type work from "../../messages/nb/work.json";

export interface Messages {
  common: typeof common;
  shell: typeof shell;
  login: typeof login;
  account: typeof account;
  confirm: typeof confirm;
  languages: typeof languages;
  domain: typeof domain;
  work: typeof work;
  sales: typeof sales;
  customers: typeof customers;
  products: typeof products;
  complaints: typeof complaints;
}

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
