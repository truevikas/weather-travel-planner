// Replace with your actual API keys
const OPENWEATHER_API_KEY = 'YOUR_OPENWEATHER_API_KEY';
const GOOGLE_MAPS_API_KEY = 'YOUR_GOOGLE_MAPS_API_KEY';

let map;
let markers = [];
let geocoder;
let temperatureOverlay = null;

// Initialize Map
function initMap() {
    // Initialize map centered on Munich
    map = L.map('map').setView([48.137154, 11.576124], 8);

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        opacity: 0.7  // Make base map slightly transparent
    }).addTo(map);

    // Initialize search input autocomplete
    const searchInput = document.getElementById('location-input');
    let timeoutId = null;
    
    searchInput.addEventListener('input', function(e) {
        const query = e.target.value.trim();
        
        // Clear previous timeout
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        
        // Clear previous suggestions if input is less than 3 characters
        if (query.length < 3) {
            clearSuggestions();
            return;
        }
        
        // Add debounce to prevent too many API calls
        timeoutId = setTimeout(() => {
            searchPlaces(query);
        }, 300);
    });

    // Initialize geocoder
    geocoder = L.Control.geocoder({
        defaultMarkGeocode: false
    })
    .on('markgeocode', function(e) {
        const { center, name } = e.geocode;
        searchLocation(center.lat, center.lng, name);
    })
    .addTo(map);

    // Add click event to map
    map.on('click', function(e) {
        const { lat, lng } = e.latlng;
        reverseGeocode(lat, lng);
    });
}

// Search places with autocomplete
async function searchPlaces(query) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`
        );
        const data = await response.json();
        displaySuggestions(data);
    } catch (error) {
        console.error('Error searching places:', error);
    }
}

// Display suggestions in a dropdown
function displaySuggestions(places) {
    clearSuggestions();
    
    if (places.length === 0) return;
    
    const searchContainer = document.querySelector('.search-container');
    const suggestionsDiv = document.createElement('div');
    suggestionsDiv.className = 'suggestions';
    
    places.forEach(place => {
        const suggestion = document.createElement('div');
        suggestion.className = 'suggestion-item';
        suggestion.textContent = place.display_name;
        
        suggestion.addEventListener('click', () => {
            document.getElementById('location-input').value = place.display_name;
            searchLocation(parseFloat(place.lat), parseFloat(place.lon), place.display_name);
            clearSuggestions();
        });
        
        suggestionsDiv.appendChild(suggestion);
    });
    
    searchContainer.appendChild(suggestionsDiv);
}

// Clear suggestions dropdown
function clearSuggestions() {
    const existing = document.querySelector('.suggestions');
    if (existing) {
        existing.remove();
    }
}

// Reverse geocode coordinates to address
async function reverseGeocode(lat, lng) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
        const data = await response.json();
        const locationName = data.display_name;
        searchLocation(lat, lng, locationName);
    } catch (error) {
        console.error('Error reverse geocoding:', error);
    }
}

// Search for a location and get weather data
async function searchLocation(lat, lng, locationName) {
    clearMarkers();
    
    // Center map on selected location
    map.setView([lat, lng], 9);
    
    // Get weather for main location
    const mainWeather = await getWeather(lat, lng);
    displayMainWeather(mainWeather, locationName);
    
    // Add marker for main location
    addMarker(lat, lng, mainWeather.temp, locationName);
    
    // Get nearby cities
    const nearbyCities = await getNearbyPlaces(lat, lng);
    
    // Get weather for nearby cities and update the map
    const weatherPromises = nearbyCities.map(async city => {
        const weather = await getWeather(city.lat, city.lng);
        displayNearbyWeather(weather, city.name, city.distance);
        addMarker(city.lat, city.lng, weather.temp, `${city.name} (${Math.round(city.distance)} km)`);
        return {
            lat: city.lat,
            lng: city.lng,
            temp: weather.temp
        };
    });

    const cityWeathers = await Promise.all(weatherPromises);
    updateTemperatureOverlay([
        { lat, lng, temp: mainWeather.temp },
        ...cityWeathers
    ]);
}

// Get weather data from Open-Meteo API
async function getWeather(lat, lng) {
    const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`
    );
    const data = await response.json();
    return {
        temp: data.current.temperature_2m,
        description: getWeatherDescription(data.current.weather_code),
        humidity: data.current.relative_humidity_2m,
        windSpeed: data.current.wind_speed_10m
    };
}

// Get nearby cities using OpenStreetMap Nominatim
async function getNearbyPlaces(lat, lng) {
    try {
        const radius = 100; // km
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?` +
            `format=json&` +
            `q=city&` +
            `lat=${lat}&` +
            `lon=${lng}&` +
            `radius=${radius}&` +
            `limit=20&` +
            `featuretype=city`
        );
        
        const data = await response.json();
        
        return data
            .filter(place => place.type === 'city' || place.type === 'town')
            .map(city => {
                const distance = getDistance(lat, lng, parseFloat(city.lat), parseFloat(city.lon));
                return {
                    name: city.display_name.split(',')[0],
                    lat: parseFloat(city.lat),
                    lng: parseFloat(city.lon),
                    distance: distance
                };
            })
            .filter(city => city.distance <= radius)
            .sort((a, b) => a.distance - b.distance);
    } catch (error) {
        console.error('Error fetching nearby cities:', error);
        return [];
    }
}

// Calculate distance between two points using Haversine formula
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in km
}

// Convert weather code to description
function getWeatherDescription(code) {
    const weatherCodes = {
        0: 'Clear sky',
        1: 'Mainly clear',
        2: 'Partly cloudy',
        3: 'Overcast',
        45: 'Foggy',
        48: 'Depositing rime fog',
        51: 'Light drizzle',
        53: 'Moderate drizzle',
        55: 'Dense drizzle',
        61: 'Slight rain',
        63: 'Moderate rain',
        65: 'Heavy rain',
        71: 'Slight snow',
        73: 'Moderate snow',
        75: 'Heavy snow',
        77: 'Snow grains',
        80: 'Slight rain showers',
        81: 'Moderate rain showers',
        82: 'Violent rain showers',
        85: 'Slight snow showers',
        86: 'Heavy snow showers',
        95: 'Thunderstorm',
        96: 'Thunderstorm with slight hail',
        99: 'Thunderstorm with heavy hail'
    };
    return weatherCodes[code] || 'Unknown';
}

// Display weather for main location
function displayMainWeather(weather, locationName) {
    const mainWeatherDiv = document.getElementById('main-weather');
    mainWeatherDiv.innerHTML = `
        <div class="weather-card ${getTemperatureClass(weather.temp)}">
            <h3>${locationName}</h3>
            <p>Temperature: ${Math.round(weather.temp)}°C</p>
            <p>Conditions: ${weather.description}</p>
            <p>Humidity: ${weather.humidity}%</p>
            <p>Wind Speed: ${weather.windSpeed} km/h</p>
        </div>
    `;
}

// Display weather for nearby cities
function displayNearbyWeather(weather, cityName, distance) {
    const nearbyWeatherList = document.getElementById('nearby-weather-list');
    const weatherCard = document.createElement('div');
    weatherCard.className = `weather-card ${getTemperatureClass(weather.temp)}`;
    weatherCard.innerHTML = `
        <h3>${cityName}</h3>
        <p>Temperature: ${Math.round(weather.temp)}°C</p>
        <p>Conditions: ${weather.description}</p>
        ${distance ? `<p>Distance: ${Math.round(distance)} km</p>` : ''}
    `;
    nearbyWeatherList.appendChild(weatherCard);
}

// Get temperature class for color coding
function getTemperatureClass(temp) {
    if (temp <= 5) return 'temperature-cold';
    if (temp > 30) return 'temperature-hot';
    return 'temperature-moderate';
}

// Add a marker to the map
function addMarker(lat, lng, temperature, title) {
    const marker = L.circleMarker([lat, lng], {
        radius: 8,
        fillColor: getMarkerColor(temperature),
        color: '#000',
        weight: 1,
        opacity: 1,
        fillOpacity: 0.7
    }).addTo(map);
    
    marker.bindPopup(`${title} - ${Math.round(temperature)}°C`);
    markers.push(marker);
}

// Get marker color based on temperature
function getMarkerColor(temp) {
    if (temp <= 5) return '#dc3545'; // darker red
    if (temp > 30) return '#ffc107'; // darker yellow
    return '#28a745'; // darker green
}

// Clear existing markers from the map
function clearMarkers() {
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];
    if (temperatureOverlay) {
        if (Array.isArray(temperatureOverlay)) {
            temperatureOverlay.forEach(polygon => map.removeLayer(polygon));
        } else {
            map.removeLayer(temperatureOverlay);
        }
        temperatureOverlay = null;
    }
    document.getElementById('nearby-weather-list').innerHTML = '';
}

// Add new function to create and update temperature overlay
function updateTemperatureOverlay(points) {
    if (temperatureOverlay) {
        map.removeLayer(temperatureOverlay);
    }

    // Create a single polygon that covers the entire visible map area
    const bounds = map.getBounds();
    const latStep = (bounds.getNorth() - bounds.getSouth()) / 20;
    const lngStep = (bounds.getEast() - bounds.getWest()) / 20;
    
    const heatLayer = L.heatLayer(points.map(p => [p.lat, p.lng, p.temp]), {
        radius: 50,
        blur: 30,
        maxZoom: 10,
        max: 40, // maximum temperature
        gradient: {
            0.0: '#dc3545', // cold (red)
            0.5: '#28a745', // moderate (green)
            1.0: '#ffc107'  // hot (yellow)
        }
    }).addTo(map);

    temperatureOverlay = heatLayer;
}

// Add helper function to get tile bounds
function getTileBounds(tilePoint, zoom) {
    const tileSizeDeg = 360 / Math.pow(2, zoom);
    return {
        north: (180 / Math.PI) * (2 * Math.atan(Math.exp(Math.PI * (1 - (tilePoint.y + 1) / Math.pow(2, zoom - 1)))) - Math.PI/2),
        south: (180 / Math.PI) * (2 * Math.atan(Math.exp(Math.PI * (1 - tilePoint.y / Math.pow(2, zoom - 1)))) - Math.PI/2),
        west: tilePoint.x * tileSizeDeg - 180,
        east: (tilePoint.x + 1) * tileSizeDeg - 180
    };
}

// Add new function to get temperature color with opacity
function getTemperatureColor(temp, opacity = 1) {
    if (temp <= 5) {
        return `rgba(255, 50, 50, ${opacity})`; // Brighter red
    } else if (temp > 30) {
        return `rgba(255, 200, 0, ${opacity})`; // Golden yellow
    } else {
        return `rgba(50, 200, 50, ${opacity})`; // Softer green
    }
}

// Initialize the map when the page loads
window.onload = initMap; 