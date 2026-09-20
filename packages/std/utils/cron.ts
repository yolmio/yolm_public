export function cronToHumanReadable(cronExpression: string): string {
  // Split the cron expression into its components
  const parts = cronExpression.trim().split(/\s+/);

  // Ensure we have the correct number of parts
  if (parts.length !== 6) {
    throw new Error(
      "Invalid cron expression format. Expected 6 parts: seconds minutes hours dayOfMonth month dayOfWeek",
    );
  }

  const [seconds, minutes, hours, dayOfMonth, month, dayOfWeek] = parts;

  // Maps for translating numeric values to names
  const monthNames: Record<string, string> = {
    "1": "January",
    "2": "February",
    "3": "March",
    "4": "April",
    "5": "May",
    "6": "June",
    "7": "July",
    "8": "August",
    "9": "September",
    "10": "October",
    "11": "November",
    "12": "December",
    JAN: "January",
    FEB: "February",
    MAR: "March",
    APR: "April",
    MAY: "May",
    JUN: "June",
    JUL: "July",
    AUG: "August",
    SEP: "September",
    OCT: "October",
    NOV: "November",
    DEC: "December",
  };

  const dayNames: Record<string, string> = {
    "0": "Sunday",
    "1": "Monday",
    "2": "Tuesday",
    "3": "Wednesday",
    "4": "Thursday",
    "5": "Friday",
    "6": "Saturday",
    SUN: "Sunday",
    MON: "Monday",
    TUE: "Tuesday",
    WED: "Wednesday",
    THU: "Thursday",
    FRI: "Friday",
    SAT: "Saturday",
  };

  // Format the time component
  let timeStr = "";
  if (hours !== "*" && minutes !== "*") {
    const hourValue = Number.parseInt(hours);
    const minuteValue = Number.parseInt(minutes);

    // Format in 12-hour format with AM/PM
    const hour12 = hourValue % 12 === 0 ? 12 : hourValue % 12;
    const ampm = hourValue < 12 ? "AM" : "PM";

    timeStr = `${hour12}:${minuteValue.toString().padStart(2, "0")} ${ampm} (${
      hourValue.toString().padStart(2, "0")
    }:${minuteValue.toString().padStart(2, "0")})`;
  } else if (hours !== "*") {
    const hourValue = Number.parseInt(hours);
    const hour12 = hourValue % 12 === 0 ? 12 : hourValue % 12;
    const ampm = hourValue < 12 ? "AM" : "PM";

    timeStr = `${hour12} ${ampm} (${hourValue.toString().padStart(2, "0")}:00)`;
  } else if (minutes !== "*") {
    timeStr = `${minutes} minutes past the hour`;
  } else if (hours === "*" && minutes === "*") {
    timeStr = "every minute";
  }

  // Add seconds if not 0
  if (seconds !== "0" && seconds !== "*") {
    timeStr += ` and ${seconds} seconds`;
  }

  // Determine the frequency (daily, weekly, monthly, etc.)
  let frequencyStr = "";

  // Special case: "0 0 4 * * 1-5" (weekdays at 4am)
  if (dayOfWeek === "1-5") {
    frequencyStr = "on weekdays (Monday through Friday)";
  } // Special case: "0 0 4 * * 0,6" (weekends)
  else if (dayOfWeek === "0,6" || dayOfWeek === "6,0") {
    frequencyStr = "on weekends (Saturday and Sunday)";
  } // Check for specific day of week
  else if (dayOfWeek !== "*") {
    // Handle ranges like 2-4
    if (dayOfWeek.includes("-")) {
      const [start, end] = dayOfWeek.split("-");
      const startName = dayNames[start] || start;
      const endName = dayNames[end] || end;
      frequencyStr = `every ${startName} through ${endName}`;
    } else {
      const days = dayOfWeek.split(",").map((day) => dayNames[day] || day);
      if (days.length === 1) {
        frequencyStr = `every ${days[0]}`;
      } else {
        const lastDay = days.pop();
        frequencyStr = `every ${days.join(", ")} and ${lastDay}`;
      }
    }
  } // Check for specific month
  else if (month !== "*") {
    const months = month.split(",").map((sql) =>
      monthNames[sql] || `month ${sql}`
    );
    if (months.length === 1) {
      frequencyStr = `every ${months[0]}`;
    } else {
      const lastMonth = months.pop();
      frequencyStr = `every ${months.join(", ")} and ${lastMonth}`;
    }

    // Add day of month if specified
    if (dayOfMonth !== "*") {
      frequencyStr += ` on the ${getDayWithSuffix(dayOfMonth)}`;
    }
  } // Check for specific day of month
  else if (dayOfMonth !== "*") {
    frequencyStr = `on the ${getDayWithSuffix(dayOfMonth)} of every month`;
  } // Every day
  else {
    frequencyStr = "every day";
  }

  // Combine the parts into a final description
  let description = "";

  // Special case for "0 * * * * *" (every minute)
  if (
    seconds === "0" &&
    minutes === "*" &&
    hours === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    return "At the start of every minute, every day";
  }

  description = `At ${timeStr} ${frequencyStr}`;

  return description.trim();
}

function getDayWithSuffix(day: string): string {
  if (day === "*") {
    return "every day";
  }

  const dayNum = Number.parseInt(day);
  if (Number.isNaN(dayNum)) {
    return day;
  }

  const lastDigit = dayNum % 10;
  const lastTwoDigits = dayNum % 100;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
    return `${dayNum}th`;
  }

  switch (lastDigit) {
    case 1:
      return `${dayNum}st`;
    case 2:
      return `${dayNum}nd`;
    case 3:
      return `${dayNum}rd`;
    default:
      return `${dayNum}th`;
  }
}
