const DEFAULT_LOCALE = "lang-COUNTRY";

const initDate = (attribute, formatOptions) => {
  const dateElements = document.querySelectorAll(`[${attribute}]`);
  if (!dateElements.length) return;
  const formatters = {};
  dateElements.forEach((dateElement) => {
    const date = new Date();
    const daysDifference = Number(dateElement.getAttribute(attribute)) || 0;
    const locale = dateElement.getAttribute("data-js-date-locale") || DEFAULT_LOCALE;
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

const initScroll = () => {
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;

    const id = link.getAttribute("href").slice(1);
    const target = id ? document.getElementById(id) : document.body;
    if (!target) return;

    event.preventDefault();

    const offset = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    const top = target.getBoundingClientRect().top + window.scrollY - offset;

    window.scrollTo({ top, behavior: "smooth" });
  });
};

const initApp = () => {
  initScroll();
  initDates();
};

initApp();
