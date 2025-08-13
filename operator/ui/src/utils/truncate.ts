export const truncate = (str: string | undefined, startLen = 6, endLen = 4) => {
    if (!str) return '';
    if (str.length <= startLen + endLen + 3) return str;
    return `${str.substring(0, startLen)}...${str.substring(str.length - endLen)}`;
};
