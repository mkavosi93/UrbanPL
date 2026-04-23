import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

// Web version — uses OpenStreetMap static image (no API key needed)
export default function GameMap({ latitude, longitude, location }) {
  if (!latitude || !longitude) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderIcon}>📍</Text>
        <Text style={styles.placeholderText} numberOfLines={1}>{location}</Text>
      </View>
    );
  }

  const mapUrl = `https://staticmap.openstreetmap.de/staticmap.php?center=${latitude},${longitude}&zoom=15&size=400x150&markers=${latitude},${longitude},red-pushpin`;

  function openDirections() {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`, '_blank');
  }

  return (
    <View style={styles.container}>
      <img
        src={mapUrl}
        alt={location}
        style={{ width: '100%', height: 150, objectFit: 'cover', display: 'block' }}
        onError={(e) => { e.target.style.display = 'none'; }}
      />
      <TouchableOpacity style={styles.directionsBtn} onPress={openDirections}>
        <Text style={styles.directionsBtnText}>🧭 Get Directions</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 150, position: 'relative' },
  placeholder: {
    height: 120, backgroundColor: '#0a2a1a',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  placeholderIcon: { fontSize: 28 },
  placeholderText: { color: '#aaa', fontSize: 12, paddingHorizontal: 16 },
  directionsBtn: {
    position: 'absolute', bottom: 8, right: 8,
    backgroundColor: 'rgba(26,26,46,0.9)',
    borderRadius: 20, paddingVertical: 5, paddingHorizontal: 12,
    borderWidth: 1, borderColor: '#C9A84C',
  },
  directionsBtnText: { color: '#C9A84C', fontSize: 12, fontWeight: '600' },
});
