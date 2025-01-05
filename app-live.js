/****************************************
 * Front-End JS Logic
 ****************************************/

const BASE_URL = "https://vmc9witvzh.execute-api.ca-central-1.amazonaws.com/default";

/**
 * Global variable for user info/state
 */
let currentUser = null;
let is24HourFormat = false;

/**
 * On page load, determine if user is logged in.
 * Then update the UI to show either the dashboard or public booking.
 */
window.addEventListener("DOMContentLoaded", async () => {
  try {
    currentUser = await fetchCurrentUser();
    updateUIBasedOnUser(currentUser);
  } catch (err) {
    console.error("Error fetching user info:", err);
    updateUIBasedOnUser(null);
  }
});

/**
 * Fetch whether the current user is logged in by calling /api/current-user.
 * - If 200 => user is logged in => return user object
 * - If 401 => user not logged in => return null
 */
async function fetchCurrentUser() {
  const response = await fetch(`${BASE_URL}/api/current-user`, {
    method: 'GET',
    credentials: 'include' // <---- important
  });
  if (response.status === 200) {
    const data = await response.json();
    if (data.loggedIn) {
      return data.user; // Return the user object (includes displayName)
    }
  }
  return null; // Not logged in
}

/**
 * Update the UI based on whether 'user' is truthy (logged in) or null.
 */
function updateUIBasedOnUser(user) {
  const dashboard = document.getElementById("dashboard");
  const publicBooking = document.getElementById("public-booking");
  const welcomeText = document.getElementById("welcome-text");
  const authLinks = document.getElementById("auth-links");

  if (user) {
    // Show the dashboard
    if (dashboard) dashboard.style.display = "block";
    if (welcomeText) welcomeText.textContent = `Welcome ${user.displayName}`;
    if (authLinks) authLinks.innerHTML = `<a href="${BASE_URL}/logout">Logout</a>`;

    fetchMyCalendar();
    fetchMyAppointments();
  } else {
    // Show the public booking
    if (dashboard) dashboard.style.display = "none";
    if (publicBooking) publicBooking.style.display = "block";
    if (welcomeText) welcomeText.textContent = "Welcome Visitor";
    if (authLinks) authLinks.innerHTML = `<a href="${BASE_URL}/auth/google">Login with Google</a>`;
  }
}

/** FRONT-END DOM Elements **/
const addTimeBlockBtn = document.getElementById("add-time-block");
const availableTimesContainer = document.getElementById("available-times-container");
const blockedDatesEl = document.getElementById("blocked-dates");
const saveCalendarBtn = document.getElementById("save-calendar");
const calendarRouteEl = document.getElementById("calendar-route");
const addAppointmentTypeBtn = document.getElementById("add-appointment-type-block");
const appointmentTypesContainer = document.getElementById("appointment-types-container");
const addBlockedDatesBtn = document.getElementById("add-blocked-dates");

const publicRouteEl = document.getElementById("public-route");
const checkAvailabilityBtn = document.getElementById("check-availability");
const availabilitySection = document.getElementById("availability-section");
const appointmentDateEl = document.getElementById("appointment-date");
const appointmentTimeEl = document.getElementById("appointment-time");
const appointmentTypeEl = document.getElementById("appointment-type");
const bookAppointmentBtn = document.getElementById("book-appointment");


const toggle24hr = document.getElementById("toggle-24hr");
function setCookie(name, value, days = 10000) {
  const d = new Date();
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/`;
}
function getCookie(name) {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? match[2] : null;
}
document.addEventListener("DOMContentLoaded", () => {
  const savedFormat = getCookie("use24Hour");
  if (savedFormat === "true") {
    is24HourFormat = true;
    if (toggle24hr) toggle24hr.checked = true;
  }
});
if (toggle24hr) {
  toggle24hr.addEventListener("change", (e) => {
    is24HourFormat = e.target.checked;
    setCookie("use24Hour", is24HourFormat ? "true" : "false");
    refreshTimeBlocks();
  });
}

function refreshTimeBlocks() {
  // console.log("Refreshing time blocks with 24-hour format:", is24HourFormat);
  fetchMyCalendar();
  fetchMyAppointments();

  const currentDate = moment($("#schedule-for-date").data('daterangepicker').startDate);
  fetchAppointmentsForDate(currentDate.format("YYYY-MM-DD"));

  updateAvailableTimesForDate(moment(appointmentDateEl.value, "ddd - MMM D, YYYY").format("YYYY-MM-DD"));
}


/****************************************
 * Public Booking Logic
 ****************************************/

let globalAvailabilityData = null;

function checkAvailability() {
  const route = publicRouteEl.value.trim();
  if (!route) {
    return alert("Enter a route first.");
  }

  fetch(`${BASE_URL}/api/calendar/${route}/availability`)
    .then((res) => res.json())
    .then((data) => {
      if (data.message) {
        return alert(data.message);
      }

      // Save data so our new function can use it
      globalAvailabilityData = data;

      // Show the booking section
      availabilitySection.classList.remove("hidden");

      // Populate the Appointment Types dropdown
      appointmentTypeEl.innerHTML = `<option value="" disabled selected>Select an option</option>`;
      if (Array.isArray(data.appointmentTypes)) {
        data.appointmentTypes.forEach((t) => {
          const option = document.createElement("option");
          option.value = t.name;
          option.textContent = `${t.name} (${t.duration} mins)`;
          option.setAttribute("data-duration", t.duration);
          option.setAttribute("data-window", t.window); // Store the window for later use
          appointmentTypeEl.appendChild(option);
        });
      }

      // Event listener to update availability based on selected appointment type
      appointmentTypeEl.addEventListener("change", async function () {
        // Update globalAvailabilityData
        fetch(`${BASE_URL}/api/calendar/${route}/availability`)
          .then((res) => res.json())
          .then((data) => {
            globalAvailabilityData = data;
          });

        // Update blockedList for the specific appointment type
        const selectedOption = appointmentTypeEl.options[appointmentTypeEl.selectedIndex];
        const windowDays = parseInt(selectedOption.getAttribute("data-window"), 10); // Retrieve window
        if (!windowDays || isNaN(windowDays)) { windowDays = 30; }
        const fullyBookedDays = await precomputeFullyBookedDays(route, windowDays);
        let blockedList = fullyBookedDays.concat(expandBlockedDatesToArray(data.blockedDates));

        // Update min and max date range.
        let validMinDate = moment().clone();
        while (blockedList.includes(validMinDate.format("YYYY-MM-DD"))) {
          validMinDate.add(1, "day");
        }
        const maxDate = moment().clone().add(windowDays, "days");

        // Update Time Picker
        const dateTimeContainer = document.getElementById("date-time-container");
        if (appointmentTypeEl.value) {
          dateTimeContainer.style.display = "block";
          updateAvailableTimesForDate(validMinDate.format("YYYY-MM-DD"));
        } else {
          dateTimeContainer.style.display = "none";
        }

        // Re-initialize the date picker with the updated min/max
        $("#appointment-date").daterangepicker(
          {
            singleDatePicker: true,
            showDropdowns: true,
            autoApply: true,
            autoUpdateInput: true,
            minDate: validMinDate,
            maxDate: maxDate,
            startDate: validMinDate,
            timePicker: false,
            locale: { format: "ddd - MMM D, YYYY" },
            isInvalidDate: function (date) {
              return blockedList.includes(date.format("YYYY-MM-DD"));
            },
          },
          function (chosenDate) {
            // Update globalAvailabilityData
            fetch(`${BASE_URL}/api/calendar/${route}/availability`)
              .then((res) => res.json())
              .then((data) => {
                globalAvailabilityData = data;
              });

            updateAvailableTimesForDate(chosenDate.format("YYYY-MM-DD"));
          }
        );
      });
    })
    .catch((err) => console.error("Error checking availability:", err));


  // Change bookAppointmentBtn display from none to block when time is selected
  appointmentTimeEl.addEventListener("change", function () {
    if (appointmentTimeEl.value) {
      bookAppointmentBtn.style.display = "block";
    }
  });

}



function expandBlockedDatesToArray(blockedDateRanges = []) {
  const blockedArr = [];
  blockedDateRanges.forEach((rangeStr) => {
    const [startStr, endStr] = rangeStr.split(" - ");
    if (!startStr || !endStr) return;

    const start = moment(startStr, "MMM D, YYYY");
    const end = moment(endStr, "MMM D, YYYY");
    if (!start.isValid() || !end.isValid()) return;

    let current = start.clone();
    while (current.isSameOrBefore(end)) {
      blockedArr.push(current.format("YYYY-MM-DD"));
      current.add(1, "day");
    }
  });
  return blockedArr;
}

/**
 * Updates the <select id="appointment-time"> with feasible times 
 * for the given dateStr (e.g. "2024-03-24").
 *
 * @param {string} dateStr - A date in "YYYY-MM-DD" format
 */
function updateAvailableTimesForDate(dateStr) {
  if (!globalAvailabilityData) {
    // console.log("No availability data loaded yet!");
    return;
  }

  const route = publicRouteEl.value.trim();
  if (!route) {
    console.log("No route specified!");
    return;
  }

  // Convert dateStr into a moment and figure out the day-of-week
  const chosenDate = moment(dateStr, "YYYY-MM-DD");
  if (!chosenDate.isValid()) {
    console.log("Invalid date string:", dateStr);
    return;
  }

  const selectedDay = chosenDate.format("dddd").toLowerCase();
  let availableSlots = globalAvailabilityData.availableTimes[selectedDay];
  if (!availableSlots || availableSlots === "Unavailable") {
    console.log(`No available slots on ${selectedDay}`);
    // Clear the appointmentTimeEl
    appointmentTimeEl.innerHTML = `<option value="" disabled selected>No slots</option>`;
    return;
  }

  // 1) Fetch the already-booked appointments for this date
  fetch(`${BASE_URL}/api/calendar/${route}/booked?date=${dateStr}`)
    .then((res) => res.json())
    .then((data) => {
      // data.booked => array of booked appointments for that date
      const bookedAppointments = data.booked || [];

      // 2) Split existing slots to remove overlaps
      availableSlots = splitSlotsByBooked(availableSlots, bookedAppointments, dateStr);
      // console.log("Available slots after split:", availableSlots);

      // 3) Use dayHasFeasibleTimes, now passing chosenDate to it
      dayHasFeasibleTimes(availableSlots, true, chosenDate, bookedAppointments);
    })
    .catch((err) => console.error("Error fetching booked appointments:", err));
}

function splitSlotsByBooked(availableSlots, bookedAppointments, dateStr) {
  // Convert each slot to {start,end} in minutes from midnight for easier manipulation
  // Convert each booked appointment likewise (time + duration).

  // For each booked appointment:
  //   1) parse its "time" into a moment or minutes offset
  //   2) derive "endTime = time + duration"
  //   3) For each slot in availableSlots, if there's overlap, split that slot into up to 2 pieces
  // (This is a simplified approach: multiple booked appointments can cause multiple splits.)

  let resultSlots = [];
  let slotObjects = [];

  // Convert the original "9:00 AM - 12:00 PM" strings into minute-based objects
  try {
    slotObjects = availableSlots.map(s => {
      const [startStr, endStr] = s.split(" - ");
      const startM = moment(startStr, ["h:mm A", "H:mm"]);
      const endM = moment(endStr, ["h:mm A", "H:mm"]);
      return {
        start: startM,
        end: endM
      };
    });
  } catch {
    // Empty slots
    slotObjects = [];
  }

  // Convert each booked appointment into minute-based objects
  //  e.g. time="9:30 AM", duration="45"
  // We'll store startMoment and endMoment.
  const bookedObjs = bookedAppointments.map(appt => {
    const apptStart = moment(appt.time, ["h:mm A", "H:mm"]);
    const apptEnd = apptStart.clone().add(parseInt(appt.duration, 10), "minutes");
    return { start: apptStart, end: apptEnd };
  });

  // For each slot, successively remove overlaps for each booked appointment
  slotObjects.forEach(slot => {
    let currentFragments = [{ start: slot.start, end: slot.end }];

    bookedObjs.forEach(booked => {
      let nextFragments = [];
      currentFragments.forEach(frag => {
        // If no overlap, keep the fragment as-is
        if (booked.end.isSameOrBefore(frag.start) || booked.start.isSameOrAfter(frag.end)) {
          nextFragments.push(frag);
        } else {
          // There's overlap => possibly split into 2 fragments
          // left fragment: from frag.start to booked.start
          if (booked.start.isAfter(frag.start)) {
            nextFragments.push({ start: frag.start, end: booked.start });
          }
          // right fragment: from booked.end to frag.end
          if (booked.end.isBefore(frag.end)) {
            nextFragments.push({ start: booked.end, end: frag.end });
          }
        }
      });
      currentFragments = nextFragments;
    });

    // Add the resulting fragments from this slot
    resultSlots = resultSlots.concat(currentFragments);
  });

  // Convert each fragment back to "HH:MM AM/PM - HH:MM AM/PM"
  let final = resultSlots.map(frag => {
    const startStr = frag.start.format("h:mm A");
    const endStr = frag.end.format("h:mm A");
    return `${startStr} - ${endStr}`;
  });

  // If dateStr == today, remove any time before the current time. If the end time has passed, remove the slot. If the start time has passed, adjust the start time.
  chosenDate = moment(dateStr, "YYYY-MM-DD");
  if (chosenDate.isSame(moment(), 'day')) {
    const earliestStart = moment().add(10 - (moment().minute() % 5), 'minutes'); // Round up to the nearest 5 minutes then add 5 minutes
    final = final.map(slot => {
      const [startStr, endStr] = slot.split(" - ");
      const slotStart = moment(startStr, ["h:mm A", "H:mm"]);
      const slotEnd = moment(endStr, ["h:mm A", "H:mm"]);
      if (slotEnd.isBefore(earliestStart)) return null;
      if (slotStart.isBefore(earliestStart)) return earliestStart.format("h:mm A") + " - " + slotEnd.format("h:mm A");
      return slot;
    }).filter(slot => slot !== null);
  }

  return final;
}

/**
 * Use one API call to load all booked data for the next `windowDays` days,
 * then figure out which days are fully booked.
 */
async function precomputeFullyBookedDays(route, windowDays) {
  // 1) Construct start & end strings for the date window
  const startStr = moment().format("YYYY-MM-DD");
  const endStr = moment().add(windowDays, "days").format("YYYY-MM-DD");

  // 2) Make ONE request to fetch all booked data for [startStr..endStr]
  let bookedByDay = {};
  try {
    const res = await fetch(
      `${BASE_URL}/api/calendar/${route}/booked-range?start=${startStr}&end=${endStr}`
    );
    const data = await res.json();
    // e.g., data.bookedByDay = { '2024-03-01': [...], '2024-03-02': [...] }
    bookedByDay = data.bookedByDay || {};
  } catch (err) {
    console.error("Error fetching booked range data:", err);
    return [];
  }

  // 3) For each day from startStr to endStr, check if that day is fully booked
  const blockedList = [];
  let current = moment(startStr, "YYYY-MM-DD");
  const end = moment(endStr, "YYYY-MM-DD");

  while (current.isSameOrBefore(end)) {
    const dateStr = current.format("YYYY-MM-DD");
    // Get the array of bookings for that day
    const bookedAppointments = bookedByDay[dateStr] || [];

    // Look up availability from globalAvailabilityData
    const dayName = current.format("dddd").toLowerCase();
    const availableSlots = globalAvailabilityData?.availableTimes?.[dayName];

    // If day is "Unavailable" or if no feasible times => mark as blocked
    if (!dayHasFeasibleTimes(splitSlotsByBooked(availableSlots, bookedAppointments, dateStr))) {
      blockedList.push(dateStr);
    }

    current.add(1, "days");
  }

  return blockedList;
}

/**
 * Returns a boolean indicating whether the given day has feasible times.
 * If updateTimeSelection is true, it also updates list of available times.
 * By using diophantine equation helper function, it only shows appointments that will not force gaps between adjacent appointments.
 * Ranks appointments based on the minimum number of adjacent appointments.
 */
function dayHasFeasibleTimes(daySlots, updateTimeSelection = false, chosenDate = moment(), bookedAppointments = []) {
  const selectedOption = appointmentTypeEl.options[appointmentTypeEl.selectedIndex];
  if (!selectedOption) return false;

  const appointmentLength = parseInt(selectedOption.getAttribute("data-duration"), 10) || 30;

  // Extract coefficients for all appointment types
  const coefficients = globalAvailabilityData.appointmentTypes.map(t => parseInt(t.duration, 10));

  // Extract coefficients for appointments valid on the chosen date
  const coefficientsOfChosenDate = globalAvailabilityData.appointmentTypes
    .filter(t => {
      const windowDays = parseInt(t.window, 10);
      return !isNaN(windowDays) && chosenDate.isBetween(moment(), moment().add(windowDays, 'days'), 'day', '[]');
    })
    .map(t => parseInt(t.duration, 10));

  const isChosenDateTomorrow = chosenDate.isBetween(moment(), moment().add(1, 'days'), 'day', '[]');
  const isChosenDateToday = chosenDate.isSame(moment(), 'day');



  // Helper function to loop through slots with given coefficients
  function processSlots(currentCoefficients, earlyStopping = false, allowGaps = false, reduceWorkdayExtension = false) {
    let output = false;
    let count = 0;
    let i = 0;
    let setOfInconvenienceMeasurements = new Set();
    const addedOptions = [];
    for (const slot of daySlots) {
      const [startStr, endStr] = slot.split(" - ");
      const slotStart = moment(startStr, ["h:mm A", "H:mm"]);
      const slotEnd = moment(endStr, ["h:mm A", "H:mm"]);
      const totalMinutes = slotEnd.diff(slotStart, "minutes");

      const entireSlotResult = findNonNegativeIntegerSolutions(currentCoefficients, totalMinutes);
      if (entireSlotResult.solutions.length > 0) {
        for (let offset = 0; offset <= totalMinutes - appointmentLength; offset += 5) {
          const leftResult = findNonNegativeIntegerSolutions(currentCoefficients, offset, !earlyStopping);
          const apptResult = findNonNegativeIntegerSolutions(currentCoefficients, appointmentLength);
          const rightResult = findNonNegativeIntegerSolutions(currentCoefficients, totalMinutes - offset - appointmentLength, !earlyStopping);

          const sizeOfForcedGap = entireSlotResult.targetUsed - (leftResult.targetUsed + apptResult.targetUsed + rightResult.targetUsed);

          let apptFitsMinNonzeroGap = false;
          if (entireSlotResult.solutions.length == 1) {
            const entireSlotResultReduced = findNonNegativeIntegerSolutions(currentCoefficients, entireSlotResult.targetUsed - 1);
            const rightResultReduced = findNonNegativeIntegerSolutions(currentCoefficients, entireSlotResult.targetUsed - 1 - offset - appointmentLength);
            apptFitsMinNonzeroGap = entireSlotResultReduced.targetUsed - (leftResult.targetUsed + apptResult.targetUsed + rightResultReduced.targetUsed) == 0;
          }

          if (sizeOfForcedGap == 0 || (apptFitsMinNonzeroGap && allowGaps)) {
            if (earlyStopping) { return { output: true, count, addedOptions }; }
            const apptStart = slotStart.clone().add(offset, "minutes").format(is24HourFormat ? "H:mm" : "h:mm A");

            let workWaitingAdded = 0;
            let workTimeAddedInt = 0;
            if (bookedAppointments.length > 0) {
              const earliestApptStart = moment(bookedAppointments[0].time, ["h:mm A", "H:mm"]);
              const latestApptEnd = moment(bookedAppointments[bookedAppointments.length - 1].time, ["h:mm A", "H:mm"]).add(bookedAppointments[bookedAppointments.length - 1].duration, 'minutes');
              if (moment(apptStart, ["h:mm A", "H:mm"]).isBefore(earliestApptStart)) {
                workTimeAddedInt = earliestApptStart.diff(moment(apptStart, ["h:mm A", "H:mm"]), 'minutes');
                workWaitingAdded = moment(apptStart, ["h:mm A", "H:mm"]).add(appointmentLength, 'minutes').diff(earliestApptStart, 'minutes');
              } else if (moment(apptStart, ["h:mm A", "H:mm"]).add(appointmentLength, 'minutes').isAfter(latestApptEnd)) {
                workTimeAddedInt = moment(apptStart, ["h:mm A", "H:mm"]).add(appointmentLength, 'minutes').diff(latestApptEnd, 'minutes');
                workWaitingAdded = latestApptEnd.diff(moment(apptStart, ["h:mm A", "H:mm"]), 'minutes');
              }
            } else {
              workTimeAddedInt = null;
            }
            let workTimeAdded = workTimeAddedInt !== null ? `${workTimeAddedInt} mins` : `new day`;

            let minimumNumberOfAdjAppt = leftResult.minSum + rightResult.minSum;
            minimumNumberOfAdjAppt += daySlots.reduce((acc, slot, index) => {
              if (index === i) return acc;
              const [startStr, endStr] = slot.split(" - ");
              const slotStart = moment(startStr, ["h:mm A", "H:mm"]);
              const slotEnd = moment(endStr, ["h:mm A", "H:mm"]);
              const totalMinutes = slotEnd.diff(slotStart, "minutes");
              const slotResult = findNonNegativeIntegerSolutions(currentCoefficients, totalMinutes);
              return acc + slotResult.minSum;
            }, 0);


            let remainingVariants = (Math.max(leftResult.countAllAtOrBelow, 1) + Math.max(rightResult.countAllAtOrBelow, 1));
            remainingVariants += daySlots.reduce((acc, slot, index) => {
              if (index === i) return acc;
              const [startStr, endStr] = slot.split(" - ");
              const slotStart = moment(startStr, ["h:mm A", "H:mm"]);
              const slotEnd = moment(endStr, ["h:mm A", "H:mm"]);
              const totalMinutes = slotEnd.diff(slotStart, "minutes");
              const slotResult = findNonNegativeIntegerSolutions(currentCoefficients, totalMinutes, true);
              return acc + slotResult.countAllAtOrBelow;
            }, 0);

            // console.log(remainingVariants, apptStart, `${slotStart.format("h:mm A")} - ${slotEnd.format("h:mm A")}`);

            let inconvenienceLevel = -(remainingVariants) + (minimumNumberOfAdjAppt * 1000) + (sizeOfForcedGap * 100000);
            setOfInconvenienceMeasurements.add(inconvenienceLevel);

            if (reduceWorkdayExtension == false || workWaitingAdded == 0) {
              addedOptions.push({
                apptStart,
                inconvenienceLevel,
                workTimeAdded,
                workWaitingAdded,
                minutesToNearestAppt: workTimeAddedInt,
                sizeOfForcedGap,
              });
            }

            output = true;
            count++;
          }
        }
      }
      i++;
    }

    // For each added option, let 'tetrisness' be 5 if minumumNumberOfAdjAppt is equal to the smallest in the set, 4 if it's equal to the the second smallest, etc.
    // note that the tetrisness ranking is inversely related to its ranking in the minimum number of adjacent appointments set.
    addedOptions.forEach(option => {
      const tetrisness = Math.max(0, 100 - Array.from(setOfInconvenienceMeasurements).sort((a, b) => a - b).indexOf(option.inconvenienceLevel));
      option.tetrisness = tetrisness;
    });


    // Remove forced-gap option if there's a gap-free option within 20 min
    for (let x = addedOptions.length - 1; x >= 0; x--) {
      const forcedGapOpt = addedOptions[x];
      if (forcedGapOpt.sizeOfForcedGap > 0) {
        const forcedGapStart = moment(forcedGapOpt.apptStart, ["h:mm A", "H:mm"]);
        const nearGapFreeExists = addedOptions.some((otherOpt) => {
          if (otherOpt === forcedGapOpt) return false;
          if (otherOpt.sizeOfForcedGap !== 0) return false;
          const otherStart = moment(otherOpt.apptStart, ["h:mm A", "H:mm"]);
          return Math.abs(forcedGapStart.diff(otherStart, "minutes")) < 20;
        });
        if (nearGapFreeExists) {
          addedOptions.splice(x, 1);
        }
      }
    }

    return { output, count, addedOptions };
  }

  function updateTimeSelect(appointmentObj) {
    appointmentTimeEl.innerHTML = `<option value="" disabled selected>Select a time</option>`;
    appointmentObj.addedOptions.forEach(option => {
      const opt = document.createElement("option");
      opt.value = option.apptStart;
      opt.textContent = option.apptStart + ` (Work Time Added: ${option.workTimeAdded}, Tetris'd ${option.tetrisness / 10}/10)`;
      appointmentTimeEl.appendChild(opt);
    });
  }

  if (updateTimeSelection) {
    // First, process with coefficientsOfChosenDate
    if (isChosenDateToday) {
      availibleAppts = processSlots(coefficientsOfChosenDate, false, true, false);
      if (availibleAppts.count < 4) { availibleAppts = processSlots(coefficients, false, true, false); }
    } else if (isChosenDateTomorrow) {
      availibleAppts = processSlots(coefficientsOfChosenDate, false, true, true);
      if (availibleAppts.count < 4) { availibleAppts = processSlots(coefficients, false, true, true); }
    } else {
      availibleAppts = processSlots(coefficientsOfChosenDate);
      if (availibleAppts.count < 4) { availibleAppts = processSlots(coefficients); }
    }

    // Update the time selection dropdown
    updateTimeSelect(availibleAppts);
  } else {
    // Just check if there are any feasible times
    if (isChosenDateToday) {
      availibleAppts = processSlots(coefficients, true, true, false);
    } else if (isChosenDateTomorrow) {
      availibleAppts = processSlots(coefficients, true, true, true);
    } else {
      availibleAppts = processSlots(coefficients, true);
    }
  }

  return availibleAppts.output;
}


/**
 * Book an appointment for the selected date, time, and type.
 */
function bookAppointment() {
  if (!currentUser) { return alert("You must be logged in to book an appointment!"); }

  const route = publicRouteEl.value.trim();
  if (!route) return alert("Enter a route first.");

  const date = moment(appointmentDateEl.value, "ddd - MMM D, YYYY").format("YYYY-MM-DD"); // e.g., "2024-09-13"
  const time = appointmentTimeEl.value; // e.g., "09:30"
  const appointmentType = appointmentTypeEl.value;
  const selectedOption = appointmentTypeEl.options[appointmentTypeEl.selectedIndex];
  const duration = selectedOption.getAttribute("data-duration"); // Get duration from the option element

  if (!date || !time || !appointmentType) {
    return alert("Please fill out date, time, and appointment type.");
  }

  fetch(`${BASE_URL}/api/calendar/${route}/book`, {
    method: "POST",
    credentials: 'include',
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, time, appointmentType, duration }), // Include duration in the payload
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        alert("Appointment booked successfully!");
        checkAppointmentsForDate();
        refreshTimeBlocks();
      } else {
        alert(`Error: ${data.message}`);
      }
    })
    .catch((err) => console.error("Error booking appointment:", err));
}


/**
 * Finds all nonnegative integer solutions for a linear Diophantine equation
 * with any number of terms. If there is no solution for the original target,
 * it decrements the target until it finds a solution or reaches 0.
 *
 * Additionally, it collects *all* solutions for all targets 0..target (inclusive).
 *
 * @param {Array} coefficients - Array of coefficients [a1, a2, ..., an].
 * @param {number} target - The initial target value for the equation.
 * @returns {Object} An object with:
 *    - targetUsed: The (possibly reduced) initial target for which a solution was found
 *    - solutions: Array of solutions in the form of arrays [x1, x2, ..., xn] for that initial target
 *    - minSumSolution: The solution with the minimum sum of its elements (for that initial target)
 *    - minSum: The sum of the elements in minSumSolution
 *    - allSolutionsAtOrBelow: Array of { target: number, solution: number[] } for all 0..target
 *    - countAllAtOrBelow: The total number of solutions in allSolutionsAtOrBelow
 */
function findNonNegativeIntegerSolutions(coefficients, target, findAtOrBelow = false) {
  // 1) Helper to find solutions for a single target
  function doSearch(coeffs, tgt) {
    const results = [];
    const numVars = coeffs.length;

    function search(vars, depth, remaining) {
      if (depth === numVars - 1) {
        const lastCoeff = coeffs[depth];
        if (remaining % lastCoeff === 0) {
          const lastVar = remaining / lastCoeff;
          if (lastVar >= 0) {
            results.push([...vars, lastVar]);
          }
        }
        return;
      }

      const maxVal = Math.floor(remaining / coeffs[depth]);
      for (let val = 0; val <= maxVal; val++) {
        search([...vars, val], depth + 1, remaining - val * coeffs[depth]);
      }
    }

    search([], 0, tgt);
    return results;
  }

  // 2) Gather *all* solutions for every target in [0..target]
  //    Store them in an array for later reference.
  let allSolutionsAtOrBelow = [];
  if (findAtOrBelow) {
    for (let t = 0; t <= target; t++) {
      const solForT = doSearch(coefficients, t);
      // Push each found solution along with its 't'
      for (const sol of solForT) {
        allSolutionsAtOrBelow.push({ target: t, solution: sol });
      }
    }
  } else {
    allSolutionsAtOrBelow = null;
  }

  // 3) Original logic: Try from 'target' downward until we find some solutions
  let solutions = doSearch(coefficients, target);
  let currentTarget = target;

  while (solutions.length === 0 && currentTarget > 0) {
    currentTarget -= 1;
    solutions = doSearch(coefficients, currentTarget);
  }

  // 4) Among the found solutions (if any), find the min-sum solution
  let minSumSolution = null;
  let minSum = null;
  if (solutions.length > 0) {
    const minResult = solutions.reduce(
      (minSol, sol) => {
        const sum = sol.reduce((acc, val) => acc + val, 0);
        return sum < minSol.sum ? { solution: sol, sum } : minSol;
      },
      {
        solution: solutions[0],
        sum: solutions[0].reduce((acc, val) => acc + val, 0),
      }
    );
    minSumSolution = minResult.solution;
    minSum = minResult.sum;
  }

  // 5) Return final results, plus the extra info about all solutions <= target
  return {
    targetUsed: currentTarget,            // possibly reduced
    solutions,                            // solutions at 'targetUsed'
    minSumSolution,                       // solution with minimum sum
    minSum,                               // that sum
    allSolutionsAtOrBelow,               // solutions for all t in [0..target]
    countAllAtOrBelow: findAtOrBelow ? allSolutionsAtOrBelow.length : null
  };
}

// ===== Example Usage =====
const coefficients = [45, 30, 20]; // Coefficients
const target = 480; // Initial target
const result = findNonNegativeIntegerSolutions(coefficients, target);
console.log(`\nOriginal target: ${target}`);
console.log("Coefficients:", coefficients);
console.log("Result:", result);


/**
 * Fetch and display the logged-in user’s upcoming appointments in bullet-point format.
 */
function fetchMyAppointments() {
  fetch(`${BASE_URL}/api/my-appointments`, { credentials: 'include' })
    .then((res) => {
      if (!res.ok) {
        throw new Error("Not authenticated or error fetching appointments.");
      }
      return res.json();
    })
    .then((data) => {
      const myAppointmentsDiv = document.getElementById("my-appointments");
      if (!data.appointments || data.appointments.length === 0) {
        myAppointmentsDiv.innerHTML = "No appointments scheduled.";
        return;
      }

      const ul = document.createElement("ul");

      data.appointments.forEach((appt) => {
        const li = document.createElement("li");

        // Convert date string (e.g. "2025-01-06") to "Jan 6, 2025"
        const dateFormatted = moment(appt.date, "YYYY-MM-DD").format("MMM D, YYYY");

        // Convert start time + duration -> e.g. "11:00 - 11:45"
        const timeFormat = is24HourFormat ? "H:mm" : "h:mm A";
        const startMoment = moment(appt.time, ["h:mm A", "H:mm"]);
        const startStr = startMoment.format(timeFormat);
        const endStr = startMoment.clone().add(appt.duration, "minutes").format(timeFormat);

        // Build a line
        // e.g.:
        //   Jan 6, 2025
        //   11:00 - 11:45 (45 minutes)
        //   Check Up (test 1)
        //   [Cancel]
        li.innerHTML = `
          <strong>${dateFormatted}</strong><br>
          ${startStr} - ${endStr} (${appt.duration} minutes)<br>
          ${appt.appointmentType} (${appt.route})
        `;

        // 1) Create a Cancel button
        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", () => {
          cancelAppointment(appt._id);
        });

        // 2) Append the cancel button
        li.appendChild(document.createElement("br"));
        li.appendChild(cancelBtn);

        ul.appendChild(li);
      });

      myAppointmentsDiv.innerHTML = ""; // Clear existing
      myAppointmentsDiv.appendChild(ul);
    })
    .catch((err) => {
      console.error("Error fetching your appointments:", err);
      document.getElementById("my-appointments").textContent =
        "Error loading your appointments or not logged in.";
    });
}

/**
 * Send a DELETE request to remove this user's appointment by _id.
 */
function cancelAppointment(appointmentId) {
  if (!confirm("Are you sure you want to cancel this appointment?")) {
    return;
  }

  fetch(`${BASE_URL}/api/my-appointments/${appointmentId}`, {
    method: "DELETE",
    credentials: 'include'
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        alert("Appointment cancelled successfully!");
        // Refresh the list of appointments
        fetchMyAppointments();
      } else {
        alert(`Error: ${data.message}`);
      }
    })
    .catch((err) => {
      console.error("Error cancelling appointment:", err);
      alert("Error cancelling appointment.");
    });
}



/****************************************
 * Private Dashboard Logic
 ****************************************/

/**
 * Fetch the user's calendar (for logged-in user).
 */
function fetchMyCalendar() {
  fetch(`${BASE_URL}/api/my-calendar`, { credentials: 'include' })
    .then((res) => {
      if (!res.ok) {
        const dashboard = document.getElementById("dashboard");
        dashboard.style.display = "none";
        throw new Error("Error fetching calendar (not logged in?)");
      }
      return res.json();
    })
    .then((calendar) => {
      const dashboard = document.getElementById("dashboard");
      const createCalendarBtn = document.getElementById("create-calendar");
      const deleteCalendarBtn = document.getElementById("delete-calendar");

      // If user has no calendar (no route)
      if (!calendar || !calendar.route) {
        // Hide the dashboard
        dashboard.style.display = "none";
        // Show "Create My Calendar"
        createCalendarBtn.style.display = "inline-block";
        deleteCalendarBtn.style.display = "none";
        return;
      }
      // Otherwise, user does have a calendar => show dashboard
      dashboard.style.display = "block";
      createCalendarBtn.style.display = "none";
      deleteCalendarBtn.style.display = "inline-block"; // can delete



      // 1) Route
      if (calendar.route) {
        calendarRouteEl.value = calendar.route;
      }

      // 2) availableTimes (object with keys like "sunday", etc.)
      //    Clear existing day-blocks, then re-initialize them, then fill them.
      //    Example: each dayBlock stores an array of strings, e.g. ["9:00 AM - 10:30 AM", "1:00 PM - 2:00 PM"]
      initializeAvailableTimes(calendar.availableTimes);

      // 3) blockedDates (array of date-range strings)
      blockedDatesEl.innerHTML = "";
      if (Array.isArray(calendar.blockedDates)) {
        calendar.blockedDates.forEach((rangeStr) => {
          addBlockedDates(rangeStr);
        });
      }

      // 4) appointmentTypes (array of {name, duration})
      appointmentTypesContainer.innerHTML = "";
      if (Array.isArray(calendar.appointmentTypes)) {
        calendar.appointmentTypes.forEach((typeObj) => {
          addAppointmentTypeBlock(typeObj.name, typeObj.duration, typeObj.window);
        });
      }

      checkAppointmentsForDate();

      // Optionally, attach remove button logic or re-init your day-block pickers if needed
    })
    .catch((err) => console.error("Error fetching calendar:", err));
}

/**
 * Create or show the user's calendar when "Create My Calendar" is clicked.
 */
const createCalendarBtn = document.getElementById("create-calendar");
const deleteCalendarBtn = document.getElementById("delete-calendar");

if (createCalendarBtn) {
  createCalendarBtn.addEventListener("click", () => {
    // Show the dashboard so they can configure
    const dashboard = document.getElementById("dashboard");
    dashboard.style.display = "block";
    createCalendarBtn.style.display = "none";
    deleteCalendarBtn.style.display = "inline-block";
  });
}

/**
 * Delete the user's calendar when "Delete My Calendar" is clicked.
 */
if (deleteCalendarBtn) {
  deleteCalendarBtn.addEventListener("click", async () => {
    if (!confirm("Are you sure you want to delete your calendar? This cannot be undone.")) {
      return;
    }
    try {
      const res = await fetch(`${BASE_URL}/api/my-calendar`, {
        method: "DELETE",
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        alert("Calendar deleted.");
        // Hide the dashboard, show "Create My Calendar"
        document.getElementById("dashboard").style.display = "none";
        document.getElementById("create-calendar").style.display = "inline-block";
        document.getElementById("delete-calendar").style.display = "none";
      } else {
        console.log("Error: " + data.message);
        // Hide the dashboard, show "Create My Calendar"
        document.getElementById("dashboard").style.display = "none";
        document.getElementById("create-calendar").style.display = "inline-block";
        document.getElementById("delete-calendar").style.display = "none";
      }
    } catch (err) {
      console.error("Error deleting calendar:", err);
      alert("Error deleting calendar.");
    }
  });
}

/**
 * Check scheduled appointments for a specific date. 
 */
function checkAppointmentsForDate() {
  // Create calendar to select a date with arrows for increment/decrement
  document.getElementById("view-schedule").innerHTML = `
    <button id="prev-day">&lt;</button>
    <input class="date-range" type="text" id="schedule-for-date" value="Select Date" readonly />
    <button id="next-day">&gt;</button>
  `;

  // Initialize daterangepicker for the date picker
  $("#schedule-for-date").daterangepicker({
    singleDatePicker: true,
    showDropdowns: true,
    startDate: moment(),
    autoApply: true,
    autoUpdateInput: true,
    timePicker: false,
    locale: { format: "ddd - MMM D, YYYY" },
  },
    function (chosenDate) {
      // Callback function when a date is selected
      const dateStr = chosenDate.format("YYYY-MM-DD");
      fetchAppointmentsForDate(dateStr);
    }
  );

  fetchAppointmentsForDate(moment().format("YYYY-MM-DD"));

  // Event listeners for incrementing/decrementing the date
  document.getElementById("prev-day").addEventListener("click", () => {
    const currentDate = moment($("#schedule-for-date").data('daterangepicker').startDate);
    const newDate = currentDate.subtract(1, 'days');
    $("#schedule-for-date").data('daterangepicker').setStartDate(newDate);
    $("#schedule-for-date").data('daterangepicker').setEndDate(newDate);
    fetchAppointmentsForDate(newDate.format("YYYY-MM-DD"));
  });

  document.getElementById("next-day").addEventListener("click", () => {
    const currentDate = moment($("#schedule-for-date").data('daterangepicker').startDate);
    const newDate = currentDate.add(1, 'days');
    $("#schedule-for-date").data('daterangepicker').setStartDate(newDate);
    $("#schedule-for-date").data('daterangepicker').setEndDate(newDate);
    fetchAppointmentsForDate(newDate.format("YYYY-MM-DD"));
  });
}

function fetchAppointmentsForDate(dateStr) {
  fetch(`${BASE_URL}/api/calendar/${calendarRouteEl.value.trim()}/booked?date=${dateStr}`)
    .then((res) => {
      return res.json();
    })
    .then((data) => {
      if (data.message) {
        return alert(data.message);
      }
      displayAppointmentsForDate(data.booked);
    })
    .catch((err) => console.error("Error fetching booked appointments:", err));
}

function displayAppointmentsForDate(appointments) {
  const scheduleContainer = document.getElementById("schedule-container");
  scheduleContainer.innerHTML = "";

  if (appointments.length === 0) {
    scheduleContainer.innerHTML = "<p>No appointments scheduled for this date.</p>";
    return;
  }

  // Sort appointments by time
  appointments.sort((a, b) => moment(a.time, ["h:mm A", "H:mm"]).diff(moment(b.time, ["h:mm A", "H:mm"])));

  const ul = document.createElement("ul");
  appointments.forEach((appt) => {
    const li = document.createElement("li");
    const timeFormat = is24HourFormat ? "H:mm" : "h:mm A";
    const formattedTime = moment(appt.time, ["h:mm A", "H:mm"]).format(timeFormat);
    const endTime = moment(appt.time, ["h:mm A", "H:mm"]).add(appt.duration, 'minutes').format(timeFormat);

    const who = appt.userName && appt.userEmail ? `<br>${appt.userName} - ${appt.userEmail}` : "";

    li.innerHTML = `${formattedTime} - ${endTime} | ${appt.appointmentType} (${appt.duration} mins)${who}`;
    ul.appendChild(li);
  });

  scheduleContainer.appendChild(ul);
}


/**
 * Add a time block row to the dashboard.
 */
function initializeAvailableTimes(existingTimes = {}) {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  // Clear out any existing content so we can rebuild fresh
  const availability = document.querySelector("#available-times-container");
  availability.innerHTML = "";

  days.forEach((day) => {
    // 1) Create the container block for this day
    const dayLower = day.toLowerCase();
    const dayBlock = document.createElement("div");
    dayBlock.innerHTML = `
      <div class="day-block" id="${dayLower}">
        <h4 class="day-label">${day}</h4>
        <div>
          <div class="time-slots"></div>
          <p class="unavailable-text" style="display: none;">Unavailable</p>
        </div>
        <button class="add-time-slot" data-day="${day}">Add Time Slot</button>
      </div>
    `;
    availability.appendChild(dayBlock);

    // 2) Grab references for .time-slots, .unavailable-text, etc.
    const addButton = dayBlock.querySelector(`.add-time-slot[data-day="${day}"]`);
    const timeSlotsContainer = dayBlock.querySelector(".time-slots");
    const unavailableText = dayBlock.querySelector(".unavailable-text");

    // 3) If 'existingTimes' has data for this day, fill it in
    const dayTimes = existingTimes[dayLower];
    if (dayTimes === "Unavailable") {
      // Mark this day as "Unavailable"
      timeSlotsContainer.innerHTML = "";
      unavailableText.style.display = "block";
    } else if (Array.isArray(dayTimes) && dayTimes.length > 0) {
      // Pre-fill each time slot
      unavailableText.style.display = "none";
      dayTimes.forEach((timeStr) => {
        createTimeBlock(timeSlotsContainer, unavailableText, timeStr);
      });
    } else {
      // No data or empty => keep it "unavailable" until user adds a slot
      unavailableText.style.display = "block";
    }

    // 4) Event listener: adding a new time slot
    addButton.addEventListener("click", () => {
      unavailableText.style.display = "none";
      createTimeBlock(timeSlotsContainer, unavailableText);
    });
  });
}

function createTimeBlock(timeSlotsContainer, unavailableText, timeStr = null) {
  const timeBlockId = `time-block-${Date.now()}`;
  let defaultVal = timeStr || (is24HourFormat ? "9:00 - 17:00" : "9:00 AM - 5:00 PM");

  // Convert timeStr to the correct format if provided
  if (timeStr) {
    const [start, end] = timeStr.split(" - ");
    const startMoment = moment(start, ["h:mm A", "H:mm"]);
    const endMoment = moment(end, ["h:mm A", "H:mm"]);
    if (is24HourFormat) {
      defaultVal = `${startMoment.format("H:mm")} - ${endMoment.format("H:mm")}`;
    } else {
      defaultVal = `${startMoment.format("h:mm A")} - ${endMoment.format("h:mm A")}`;
    }
  }

  const timeBlock = document.createElement("div");
  timeBlock.className = "time-block added";
  timeBlock.innerHTML = `
    <input class="date-range time-range" type="text" id="${timeBlockId}" name="duration" value="${defaultVal}" readonly>
    <button class="remove-time-slot">Remove</button>
  `;

  timeSlotsContainer.appendChild(timeBlock);

  // Remove time block logic
  const removeButton = timeBlock.querySelector(".remove-time-slot");
  removeButton.addEventListener("click", () => {
    timeBlock.remove();
    // If no time blocks remain, set "Unavailable"
    if (timeSlotsContainer.children.length === 0) {
      unavailableText.style.display = "block";
    }
  });

  // Initialize daterangepicker for this block
  $(`#${timeBlockId}`).daterangepicker({
    timePicker: true,
    timePicker24Hour: is24HourFormat,
    timePickerIncrement: 5,
    locale: {
      format: is24HourFormat ? "H:mm" : "h:mm A",
    },
  }).on("show.daterangepicker", function (ev, picker) {
    // Hide the calendar table
    picker.container.find(".calendar-table").hide();

    // Adjust the style for the time pickers
    const timePickers = picker.container.find(".drp-calendar.left, .drp-calendar.right");
    timePickers.css({ margin: "0px 10px 5px 10px", padding: "0" });

    $(timePickers[1]).css({
      margin: "-8px 10px 5px 10px",
    });

    const timePickerOptions = picker.container.find(".hourselect, .minuteselect, .ampmselect");
    timePickerOptions.css({ cursor: "pointer" });

    // Insert a custom separator between the time pickers (once)
    if (timePickers.length === 2 && !picker.container.find(".custom-separator").length) {
      const separator = $('<div class="custom-separator"></div>').css({});
      timePickers.first().after(separator);
    }
  });
}

// Initialize time blocks on page load
initializeAvailableTimes();



/**
 * Blocked Dates
 */
function addBlockedDates(blockedDates = null) {
  const block = document.createElement("div");
  block.className = "blocked-date-block added";

  block.innerHTML = `
    <input class="date-range blocked-date-range" type="text" name="blocked-dates" value="${blockedDates}" readonly/>
    <button class="remove-blocked-dates">Remove</button>
  `;
  blockedDatesEl.appendChild(block);

  const removeButton = block.querySelector(".remove-blocked-dates");
  removeButton.addEventListener("click", () => {
    block.remove();
  });

  // Initialize daterangepicker on the new input
  $(block.querySelector('input[name="blocked-dates"]')).daterangepicker({
    minDate: moment(),
    locale: {
      format: 'MMM D, YYYY'
    }
  });
}


/**
 * Add an appointment type row.
 */
function addAppointmentTypeBlock(name = "", duration = "", window = "") {
  const block = document.createElement("div");
  block.className = "appointment-type-block added";

  block.innerHTML = `<div>
    <div class="type-parameter">
      <label>Name:</label>
      <input type="text" class="type-input type-name" value="${name}" placeholder="Consultation" />
    </div>
    <div class="type-parameter">
      <label>Duration (mins):</label>
      <select class="type-input type-duration"></select>
    </div>
    <div class="type-parameter">
      <label>Booking Window (days):</label> 
      <input type="number" value="${window}" class="type-input type-booking-window" placeholder="30" step="1" min="1"/>
    </div>  
  </div>
  <button class="remove-appointment remove">Remove</button>`;
  appointmentTypesContainer.appendChild(block);

  // Update durations for the newly added block
  const newDurationSelect = block.querySelector(".type-duration");
  updateTypeDuration(newDurationSelect, duration);

  // Ensure the booking window is an integer
  const bookingWindowInput = block.querySelector(".type-booking-window");
  enforceIntegerInput(bookingWindowInput);

  const removeButton = block.querySelector(".remove-appointment");
  removeButton.addEventListener("click", () => {
    block.remove();
    toggleBookingWindowInfo();
  });

  toggleBookingWindowInfo();
}

function updateTypeDuration(select = null, selectedValue = null) {
  const gcf = parseInt(document.getElementById("greatest-common-factor").value, 10);
  const maxDuration = 240; // Set an upper limit for durations
  const durationSelects = select ? [select] : document.querySelectorAll(".type-duration");

  durationSelects.forEach((select) => {
    // Clear existing options
    select.innerHTML = "";

    // Populate with valid multiples of GCF
    for (let i = gcf; i <= maxDuration; i += gcf) {
      const option = document.createElement("option");
      option.value = i;

      if (parseInt(i, 10) === parseInt(selectedValue, 10)) {
        option.selected = true;
      }

      // Human-readable labels
      if (i === 60) {
        option.textContent = "1 hour";
      } else if (i > 60 && i % 60 === 0) {
        option.textContent = `${i / 60} hours`;
      } else if (i > 60) {
        const hours = Math.floor(i / 60);
        const minutes = i % 60;
        option.textContent = `${hours} hour${hours > 1 ? "s" : ""} ${minutes} minute${minutes > 1 ? "s" : ""}`;
      } else {
        option.textContent = `${i} minute${i > 1 ? "s" : ""}`;
      }

      select.appendChild(option);
    }
  });
}

// Event listener for updating all duration dropdowns when GCF changes
document.getElementById("greatest-common-factor").addEventListener("change", function () {
  updateTypeDuration();
});

// Initialize valid durations on page load
document.addEventListener("DOMContentLoaded", function () {
  const event = new Event("change");
  document.getElementById("greatest-common-factor").dispatchEvent(event);
});

function enforceIntegerInput(inputElement) {
  inputElement.addEventListener("input", () => {
    // Remove non-digit characters
    inputElement.value = inputElement.value.replace(/\D/g, "");

    // Ensure the value remains an integer
    const intValue = parseInt(inputElement.value, 10);
    if (isNaN(intValue) || intValue < 1) {
      inputElement.value = ""; // Reset invalid values
    } else {
      inputElement.value = intValue;
    }
  });
}

function toggleBookingWindowInfo() {
  const bookingWindowInfo = document.getElementById("booking-window-info");
  const appointmentBlocks = document.querySelectorAll(".appointment-type-block");

  // Show if there are multiple blocks, hide otherwise
  if (appointmentBlocks.length > 0) {
    bookingWindowInfo.style.display = "block";
  } else {
    bookingWindowInfo.style.display = "none";
  }
}


/**
 * Booking Window
 */

// Apply enforceIntegerInput to all elements with the class ".integer-number-input"
document.querySelectorAll(".integer-number-input").forEach((inputElement) => {
  enforceIntegerInput(inputElement);
});

/**
 * Gather input data and send to the server to save the calendar.
 */
function saveCalendar() {
  // The "route" (like "my-cool-calendar")
  const route = calendarRouteEl.value.trim();

  if (!route || route.length < 3) {
    alert("Enter a route name (3 characters minimum).");
    return; // Exit the function without saving
  }

  // Build day-block availability data
  const availableTimes = {}; // e.g. { sunday: [ "9:00 AM - 10:00 AM", ... ], monday: ... }
  document.querySelectorAll(".day-block").forEach((dayBlock) => {
    const day = dayBlock.id; // e.g. "sunday", "monday"
    let timeSlots = [];

    // For each .time-block inside .time-slots
    dayBlock.querySelectorAll(".time-block").forEach((timeBlock) => {
      // Example: if using a daterangepicker field
      const drpInput = timeBlock.querySelector(".time-range");
      if (drpInput && drpInput.value) {
        timeSlots.push(drpInput.value); // e.g., "9:00 AM - 12:00 PM"
      }
    });

    // Merge overlapping time slots
    timeSlots = mergeTimeSlots(timeSlots);
    availableTimes[day] = timeSlots.length > 0 ? timeSlots : "Unavailable";
  });

  // Gather blocked date ranges
  const blockedDates = [];
  blockedDatesEl.querySelectorAll(".blocked-date-block").forEach((block) => {
    const input = block.querySelector(".blocked-date-range");
    if (input && input.value) {
      blockedDates.push(input.value); // e.g. "Sep 12, 2024 - Sep 14, 2024"
    }
  });

  /**
   * Merge overlapping time slots into one.
   * @param {Array} timeSlots - Array of time slots as strings, e.g., ["9:00 AM - 10:00 AM", "9:30 AM - 11:00 AM"]
   * @returns {Array} - Merged time slots
   */
  function mergeTimeSlots(timeSlots) {
    if (timeSlots.length === 0) return [];

    // Convert time slots to moment objects
    const slots = timeSlots.map(slot => {
      const [start, end] = slot.split(" - ");
      return { start: moment(start, ["h:mm A", "H:mm"]), end: moment(end, ["h:mm A", "H:mm"]) };
    });

    // Sort slots by start time
    slots.sort((a, b) => a.start - b.start);

    const mergedSlots = [slots[0]];

    for (let i = 1; i < slots.length; i++) {
      const lastMerged = mergedSlots[mergedSlots.length - 1];
      const current = slots[i];

      if (current.start.isSameOrBefore(lastMerged.end)) {
        // Overlapping or contiguous, merge them
        lastMerged.end = moment.max(lastMerged.end, current.end);
      } else {
        // No overlap, add as a new slot
        mergedSlots.push(current);
      }
    }

    // Convert merged slots back to strings
    return mergedSlots.map(slot => `${slot.start.format("h:mm A")} - ${slot.end.format("h:mm A")}`);
  }

  // Gather appointment types
  const appointmentTypes = [];
  appointmentTypesContainer.querySelectorAll(".appointment-type-block").forEach((block) => {
    const name = block.querySelector(".type-name").value.trim();
    const duration = block.querySelector(".type-duration").value.trim();
    const window = block.querySelector(".type-booking-window").value.trim();
    if (name && duration && window) {
      appointmentTypes.push({ name, duration, window });
    }
  });

  // Send it all to POST /api/save-calendar
  fetch(`${BASE_URL}/api/save-calendar`, {
    method: "POST",
    credentials: 'include',
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      route,
      availableTimes,
      blockedDates,
      appointmentTypes
    }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        alert("Calendar saved successfully!");
        refreshTimeBlocks();
      } else {
        alert("Error: " + data.message);
      }
    })
    .catch((err) => console.error("Error saving calendar:", err));
}







/** Calendar Configuration Event listeners **/
if (addTimeBlockBtn) {
  addTimeBlockBtn.addEventListener("click", () => addTimeBlock());
}
if (addBlockedDatesBtn) {
  addBlockedDatesBtn.addEventListener("click", () => addBlockedDates());
}
if (addAppointmentTypeBtn) {
  addAppointmentTypeBtn.addEventListener("click", () => addAppointmentTypeBlock());
}
if (saveCalendarBtn) {
  saveCalendarBtn.addEventListener("click", saveCalendar);
}

/** Public Event listeners **/
if (checkAvailabilityBtn) {
  checkAvailabilityBtn.addEventListener("click", checkAvailability);
}
if (bookAppointmentBtn) {
  bookAppointmentBtn.addEventListener("click", bookAppointment);
}