import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';

export default function GameMap({ latitude, longitude, location }) {
  if (!latitude || !longitude) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderIcon}>📍</Text>
        <Text style={styles.placeholderText} numberOfLines={1}>{location}</Text>
      </View>
    );
  }

  function openDirections() {
    const url = `maps://?daddr=${latitude},${longitude}&dirflg=d`;
    Linking.canOpenURL(url).then(supported => {
      if (supported) {
        Linking.openURL(url);
      } else {
        Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`);
      }
    });
  }

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={{
          latitude,
          longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        }}
        scrollEnabled={false}
        zoomEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
      >
        <Marker
          coordinate={{ latitude, longitude }}
          title={location?.split(',')[0]}
        />
      </MapView>

      <TouchableOpacity style={styles.directionsBtn} onPress={openDirections}>
        <Text style={styles.directionsBtnText}>🧭 Get Directions</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 150, position: 'relative' },
  map: { width: '100%', height: '100%' },
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
