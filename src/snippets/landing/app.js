const DEFAULT_LOCALE = "lang-COUNTRY";
const CONTENT_BLOCK = ".CONTENT_BLOCK";

const initDate = (attribute, formatOptions) => {
  const dateElements = document.querySelectorAll(`[${attribute}]`);
  if (!dateElements.length) return;
  const formatters = {};
  dateElements.forEach((dateElement) => {
    const date = new Date();
    const daysDifference = Number(dateElement.getAttribute(attribute)) || 0;
    const locale =
      dateElement.getAttribute("data-js-date-locale") || DEFAULT_LOCALE;
    if (!formatters[locale]) {
      formatters[locale] = new Intl.DateTimeFormat(locale, formatOptions);
    }
    date.setDate(date.getDate() + daysDifference);
    dateElement.textContent = formatters[locale].format(date);
  });
};

const initNumericDate = () => {
  initDate("data-js-numeric-date", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const initLongDate = () => {
  initDate("data-js-long-date", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
};

const initShortDate = () => {
  initDate("data-js-short-date", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const initYear = () => {
  document.querySelectorAll("[data-js-year]").forEach((el) => {
    const offset = Number(el.getAttribute("data-js-year")) || 0;
    el.textContent = String(new Date().getFullYear() + offset);
  });
};

const initDates = () => {
  initNumericDate();
  initLongDate();
  initShortDate();
  initYear();
};

const initLinks = () => {
  const contentBlocks = [...document.querySelectorAll(CONTENT_BLOCK)];

  document.querySelectorAll("a").forEach((link) => {
    if (contentBlocks.some((block) => block.contains(link))) return;
    link.dataset.disabled = "true";
    link.setAttribute("aria-disabled", "true");
    link.setAttribute("tabindex", "-1");
    link.style.setProperty("pointer-events", "none", "important");
    link.style.setProperty("cursor", "default", "important");
    link.addEventListener("click", (event) => event.preventDefault());
  });
};

const initApp = () => {
  initLinks();
  initDates();
};

initApp();
