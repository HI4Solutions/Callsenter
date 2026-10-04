// The texts of what VeriQall sends that is not an answer to a request: the invitation e-mail,
// the invoice e-mail and the invoice PDF (docs/plan.md, sections 16, 17 and 19). They are written
// in the recipient call centre's language (organizations.default_locale), not the sender's.
// A new language in packages/shared/src/locales.ts needs its entry here; the type makes it
// required.
import { LOCALES, type Locale } from "@veriqall/shared";

interface DocumentTexts {
  invitation: {
    subject: (organization: string) => string;
    hello: (name: string) => string;
    // The organisation as given: plain in the text, in <strong> in the HTML.
    invited: (organization: string) => string;
    signInBelow: string;
    signIn: string;
    accept: string;
    personal: string;
  };
  invoice: {
    invoice: string;
    creditNote: string;
    // "Faktura 12 fra Hi4 Solutions AS"
    title: (kind: string, number: string, seller: string) => string;
    draft: string;
    draftMark: string;
    issueDate: string;
    dueDate: string;
    onSending: string;
    customerNumber: string;
    credits: string;
    period: string;
    to: string;
    from: string;
    orgNo: string;
    orgNoInText: string;
    attention: string;
    description: string;
    quantity: string;
    price: string;
    vat: string;
    amount: string;
    subtotal: string;
    total: string;
    toCredit: string;
    lineVat: (percent: string) => string;
    percent: (value: number) => string;
    accountNumber: string;
    pay: (
      amount: string,
      account: string,
      due: string,
      number: string,
    ) => string;
    credit: (number: string) => string;
    // The credit note's text when superadmin gives no reason (stored on the credit note).
    creditReason: (number: string) => string;
    markDraft: string;
    mark: (number: string, due: string) => string;
    // File names of the PDF, without .pdf.
    fileDraft: string;
    fileInvoice: string;
    fileCredit: string;
    // Usage lines (billing.ts): "Transkribering oktober 2026, timer lyd".
    usageAudio: (month: string) => string;
    usageAi: (month: string) => string;
  };
  // A superadmin's answer to a request from the landing page's contact form.
  contactReply: {
    subject: string;
    youWrote: string;
    answerHint: string;
  };
}

export const DOCUMENT_TEXTS: Record<Locale, DocumentTexts> = {
  nb: {
    invitation: {
      subject: (organization) => `Invitasjon til ${organization} i VeriQall`,
      hello: (name) => `Hei ${name},`,
      invited: (organization) =>
        `Du er invitert til ${organization} i VeriQall.`,
      signInBelow: "Logg inn med BankID eller Vipps via lenken under:",
      signIn: "Logg inn med BankID eller Vipps:",
      accept: "Godta invitasjonen",
      personal: "Lenken er personlig og kan bare brukes én gang.",
    },
    invoice: {
      invoice: "Faktura",
      creditNote: "Kreditnota",
      title: (kind, number, seller) => `${kind} ${number} fra ${seller}`,
      draft: "utkast",
      draftMark: "FAKTURAUTKAST",
      issueDate: "Fakturadato",
      dueDate: "Forfall",
      onSending: "Ved sending",
      customerNumber: "Kundenummer",
      credits: "Krediterer faktura",
      period: "Periode",
      to: "Til",
      from: "Fra",
      orgNo: "Org.nr.",
      orgNoInText: "org.nr.",
      attention: "Att.",
      description: "Beskrivelse",
      quantity: "Antall",
      price: "Pris",
      vat: "Mva",
      amount: "Beløp",
      subtotal: "Sum eks. mva",
      total: "Å betale",
      toCredit: "Til gode",
      lineVat: (percent) => `mva ${percent}`,
      percent: (value) => `${value} %`,
      accountNumber: "Kontonummer",
      pay: (amount, account, due, number) =>
        `Betal ${amount} til konto ${account} innen ${due}, og merk betalingen med fakturanummer ${number}.`,
      credit: (number) =>
        `Kreditnota for faktura ${number}. Beløpet trekkes fra det dere skylder, eller betales tilbake.`,
      creditReason: (number) => `Kreditnota for faktura ${number}`,
      markDraft: "Merk betalingen med fakturanummeret (tildeles ved sending).",
      mark: (number, due) =>
        `Merk betalingen med fakturanummer ${number}. Forfall ${due}.`,
      fileDraft: "fakturautkast",
      fileInvoice: "faktura",
      fileCredit: "kreditnota",
      usageAudio: (month) => `Transkribering ${month}, timer lyd`,
      usageAi: (month) => `AI-kontroll ${month}, samtaler`,
    },
    contactReply: {
      subject: "Svar på henvendelsen din til VeriQall",
      youWrote: "Du skrev:",
      answerHint: "Du kan svare direkte på denne e-posten.",
    },
  },
  en: {
    invitation: {
      subject: (organization) => `Invitation to ${organization} in VeriQall`,
      hello: (name) => `Hi ${name},`,
      invited: (organization) =>
        `You have been invited to ${organization} in VeriQall.`,
      signInBelow: "Sign in with BankID or Vipps using the link below:",
      signIn: "Sign in with BankID or Vipps:",
      accept: "Accept the invitation",
      personal: "The link is personal and can only be used once.",
    },
    invoice: {
      invoice: "Invoice",
      creditNote: "Credit note",
      title: (kind, number, seller) => `${kind} ${number} from ${seller}`,
      draft: "draft",
      draftMark: "DRAFT INVOICE",
      issueDate: "Invoice date",
      dueDate: "Due date",
      onSending: "On sending",
      customerNumber: "Customer number",
      credits: "Credits invoice",
      period: "Period",
      to: "To",
      from: "From",
      orgNo: "Org. no.",
      orgNoInText: "org. no.",
      attention: "Attn.",
      description: "Description",
      quantity: "Quantity",
      price: "Price",
      vat: "VAT",
      amount: "Amount",
      subtotal: "Total excl. VAT",
      total: "Amount due",
      toCredit: "In your favour",
      lineVat: (percent) => `VAT ${percent}`,
      percent: (value) => `${value}%`,
      accountNumber: "Account number",
      pay: (amount, account, due, number) =>
        `Pay ${amount} to account ${account} by ${due}, and mark the payment with invoice number ${number}.`,
      credit: (number) =>
        `Credit note for invoice ${number}. The amount is deducted from what you owe, or paid back.`,
      creditReason: (number) => `Credit note for invoice ${number}`,
      markDraft:
        "Mark the payment with the invoice number (assigned on sending).",
      mark: (number, due) =>
        `Mark the payment with invoice number ${number}. Due ${due}.`,
      fileDraft: "invoice-draft",
      fileInvoice: "invoice",
      fileCredit: "credit-note",
      usageAudio: (month) => `Transcription ${month}, hours of audio`,
      usageAi: (month) => `AI control ${month}, calls`,
    },
    contactReply: {
      subject: "Reply to your enquiry to VeriQall",
      youWrote: "You wrote:",
      answerHint: "You can reply directly to this e-mail.",
    },
  },
  sv: {
    invitation: {
      subject: (organization) => `Inbjudan till ${organization} i VeriQall`,
      hello: (name) => `Hej ${name},`,
      invited: (organization) =>
        `Du har bjudits in till ${organization} i VeriQall.`,
      signInBelow: "Logga in med BankID eller Vipps via länken nedan:",
      signIn: "Logga in med BankID eller Vipps:",
      accept: "Acceptera inbjudan",
      personal: "Länken är personlig och kan bara användas en gång.",
    },
    invoice: {
      invoice: "Faktura",
      creditNote: "Kreditnota",
      title: (kind, number, seller) => `${kind} ${number} från ${seller}`,
      draft: "utkast",
      draftMark: "FAKTURAUTKAST",
      issueDate: "Fakturadatum",
      dueDate: "Förfallodag",
      onSending: "Vid utskick",
      customerNumber: "Kundnummer",
      credits: "Krediterar faktura",
      period: "Period",
      to: "Till",
      from: "Från",
      orgNo: "Org.nr",
      orgNoInText: "org.nr",
      attention: "Att.",
      description: "Beskrivning",
      quantity: "Antal",
      price: "Pris",
      vat: "Moms",
      amount: "Belopp",
      subtotal: "Summa exkl. moms",
      total: "Att betala",
      toCredit: "Till godo",
      lineVat: (percent) => `moms ${percent}`,
      percent: (value) => `${value} %`,
      accountNumber: "Kontonummer",
      pay: (amount, account, due, number) =>
        `Betala ${amount} till konto ${account} senast ${due} och märk betalningen med fakturanummer ${number}.`,
      credit: (number) =>
        `Kreditnota för faktura ${number}. Beloppet dras av från det ni är skyldiga eller betalas tillbaka.`,
      creditReason: (number) => `Kreditnota för faktura ${number}`,
      markDraft: "Märk betalningen med fakturanumret (tilldelas vid utskick).",
      mark: (number, due) =>
        `Märk betalningen med fakturanummer ${number}. Förfallodag ${due}.`,
      fileDraft: "fakturautkast",
      fileInvoice: "faktura",
      fileCredit: "kreditnota",
      usageAudio: (month) => `Transkribering ${month}, timmar ljud`,
      usageAi: (month) => `AI-kontroll ${month}, samtal`,
    },
    contactReply: {
      subject: "Svar på din förfrågan till VeriQall",
      youWrote: "Du skrev:",
      answerHint: "Du kan svara direkt på det här e-postmeddelandet.",
    },
  },
  da: {
    invitation: {
      subject: (organization) => `Invitation til ${organization} i VeriQall`,
      hello: (name) => `Hej ${name},`,
      invited: (organization) =>
        `Du er inviteret til ${organization} i VeriQall.`,
      signInBelow: "Log ind med BankID eller Vipps via linket nedenfor:",
      signIn: "Log ind med BankID eller Vipps:",
      accept: "Accepter invitationen",
      personal: "Linket er personligt og kan kun bruges én gang.",
    },
    invoice: {
      invoice: "Faktura",
      creditNote: "Kreditnota",
      title: (kind, number, seller) => `${kind} ${number} fra ${seller}`,
      draft: "udkast",
      draftMark: "FAKTURAUDKAST",
      issueDate: "Fakturadato",
      dueDate: "Forfaldsdato",
      onSending: "Ved afsendelse",
      customerNumber: "Kundenummer",
      credits: "Krediterer faktura",
      period: "Periode",
      to: "Til",
      from: "Fra",
      orgNo: "Org.nr.",
      orgNoInText: "org.nr.",
      attention: "Att.",
      description: "Beskrivelse",
      quantity: "Antal",
      price: "Pris",
      vat: "Moms",
      amount: "Beløb",
      subtotal: "I alt ekskl. moms",
      total: "At betale",
      toCredit: "Til gode",
      lineVat: (percent) => `moms ${percent}`,
      percent: (value) => `${value} %`,
      accountNumber: "Kontonummer",
      pay: (amount, account, due, number) =>
        `Betal ${amount} til konto ${account} senest ${due}, og mærk betalingen med fakturanummer ${number}.`,
      credit: (number) =>
        `Kreditnota for faktura ${number}. Beløbet trækkes fra det, I skylder, eller betales tilbage.`,
      creditReason: (number) => `Kreditnota for faktura ${number}`,
      markDraft:
        "Mærk betalingen med fakturanummeret (tildeles ved afsendelse).",
      mark: (number, due) =>
        `Mærk betalingen med fakturanummer ${number}. Forfald ${due}.`,
      fileDraft: "fakturaudkast",
      fileInvoice: "faktura",
      fileCredit: "kreditnota",
      usageAudio: (month) => `Transskription ${month}, timer lyd`,
      usageAi: (month) => `AI-kontrol ${month}, samtaler`,
    },
    contactReply: {
      subject: "Svar på din henvendelse til VeriQall",
      youWrote: "Du skrev:",
      answerHint: "Du kan svare direkte på denne e-mail.",
    },
  },
  de: {
    invitation: {
      subject: (organization) => `Einladung zu ${organization} in VeriQall`,
      hello: (name) => `Hallo ${name},`,
      invited: (organization) =>
        `Sie wurden zu ${organization} in VeriQall eingeladen.`,
      signInBelow:
        "Melden Sie sich über den folgenden Link mit BankID oder Vipps an:",
      signIn: "Melden Sie sich mit BankID oder Vipps an:",
      accept: "Einladung annehmen",
      personal: "Der Link ist persönlich und kann nur einmal verwendet werden.",
    },
    invoice: {
      invoice: "Rechnung",
      creditNote: "Gutschrift",
      title: (kind, number, seller) => `${kind} ${number} von ${seller}`,
      draft: "Entwurf",
      draftMark: "RECHNUNGSENTWURF",
      issueDate: "Rechnungsdatum",
      dueDate: "Fällig am",
      onSending: "Beim Versand",
      customerNumber: "Kundennummer",
      credits: "Gutschrift zu Rechnung",
      period: "Zeitraum",
      to: "An",
      from: "Von",
      orgNo: "Org.-Nr.",
      orgNoInText: "Org.-Nr.",
      attention: "z. Hd.",
      description: "Beschreibung",
      quantity: "Menge",
      price: "Preis",
      vat: "MwSt.",
      amount: "Betrag",
      subtotal: "Summe ohne MwSt.",
      total: "Zu zahlen",
      toCredit: "Guthaben",
      lineVat: (percent) => `MwSt. ${percent}`,
      percent: (value) => `${value} %`,
      accountNumber: "Kontonummer",
      pay: (amount, account, due, number) =>
        `Bitte zahlen Sie ${amount} bis ${due} auf das Konto ${account} und geben Sie die Rechnungsnummer ${number} als Verwendungszweck an.`,
      credit: (number) =>
        `Gutschrift zu Rechnung ${number}. Der Betrag wird mit Ihren offenen Beträgen verrechnet oder zurückgezahlt.`,
      creditReason: (number) => `Gutschrift zu Rechnung ${number}`,
      markDraft:
        "Geben Sie die Rechnungsnummer als Verwendungszweck an (wird beim Versand vergeben).",
      mark: (number, due) =>
        `Verwendungszweck: Rechnungsnummer ${number}. Fällig am ${due}.`,
      fileDraft: "rechnungsentwurf",
      fileInvoice: "rechnung",
      fileCredit: "gutschrift",
      usageAudio: (month) => `Transkription ${month}, Stunden Audio`,
      usageAi: (month) => `KI-Prüfung ${month}, Gespräche`,
    },
    contactReply: {
      subject: "Antwort auf Ihre Anfrage an VeriQall",
      youWrote: "Sie schrieben:",
      answerHint: "Sie können direkt auf diese E-Mail antworten.",
    },
  },
};

// Amounts in Norwegian kroner, as the language writes them. Norwegian keeps "1 234,50 kr".
export function formatKroner(locale: Locale, value: string | number): string {
  if (locale === "nb") {
    return `${new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))} kr`;
  }
  return new Intl.NumberFormat(LOCALES[locale].tag, {
    style: "currency",
    currency: "NOK",
    currencyDisplay: "code",
  }).format(Number(value));
}

export function formatQuantity(locale: Locale, value: string | number): string {
  return Number(value).toLocaleString(LOCALES[locale].tag).replace("−", "-");
}

// A date (YYYY-MM-DD) written out ("3. oktober 2026", "3 October 2026").
export function formatLongDate(locale: Locale, value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(LOCALES[locale].tag, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

// A date (YYYY-MM-DD) in figures ("03.10.2026", "03/10/2026").
export function formatShortDate(locale: Locale, value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(LOCALES[locale].tag, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

// A month (YYYY-MM) with its name ("oktober 2026").
export function formatMonth(locale: Locale, month: string): string {
  return new Intl.DateTimeFormat(LOCALES[locale].tag, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}
