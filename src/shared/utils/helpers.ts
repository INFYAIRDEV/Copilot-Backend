export const formatDate = (date: Date): string => {
  return date.toISOString().split("T")[0];
};

export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};
