import { ModelData } from 'ember-data/-private';
import { assert } from '@ember/debug';
import { typeOf } from '@ember/utils';
import { get, setProperties, computed } from '@ember/object';
import { isArray } from '@ember/array';
import { copy } from '@ember/object/internals';
import isInstanceOfType from './util/instance-of-type';
import {
  fragmentDidDirty,
  fragmentDidReset
} from './states';
import StatefulArray from './array/stateful';
import FragmentArray from './array/fragment';
import {
  internalModelFor,
  setFragmentOwner,
  setFragmentData,
  createFragment,
  isFragment
} from './fragment';

export default class FragmentModelData extends ModelData {
    constructor(modelName, id, store, data, internalModel) {
      super(modelName, id, store, data, internalModel);

      // TODO Optimize
      this.fragmentData = Object.create(null);
      this.fragments = Object.create(null);
      this.fragmentNames = [];
      this.internalModel.type.eachComputedProperty((name, options) => {
        if (options.isFragment) {
          this.fragmentNames.push(name)
        }
      });
    }

    // Returns the value of the property or the default propery
    getFragmentWithDefault(key, options, type) {
      let data = this.fragmentData[key];
      if (data !== undefined) {
        return data;
      }
      return getFragmentDefaultValue(options, type);
    }

    setupFragment(key, options, declaredModelName, record) {
      let data = this.getFragmentWithDefault(key, options, 'object');
      let fragment = this.fragments[key];

      // Regardless of whether being called as a setter or getter, the fragment
      // may not be initialized yet, in which case the data will contain a
      // raw response or a stashed away fragment

      // If we already have a processed fragment in _data and our current fragment is
      // null simply reuse the one from data. We can be in this state after a rollback
      // for example
      if (!fragment && isFragment(data)) {
        fragment = data;
      // Else initialize the fragment
      } else if (data && data !== fragment) {
        if (fragment) {
          setFragmentData(fragment, data);
        } else {
          fragment = createFragment(this.store, declaredModelName, record, key, options, data);
        }

       // this.fragments[key] = fragment;
        this.fragmentData[key] = fragment;
      } else {
        // Handle the adapter setting the fragment to null
        fragment = data;
      }

      return fragment;
    }

    setFragmentValue(key, fragment, value, record, declaredModelName, options) {
      let store = this.store;
      assert(`You can only assign \`null\`, an object literal or a '${declaredModelName}' fragment instance to this property`, value === null || typeOf(value) === 'object' || isInstanceOfType(store.modelFor(declaredModelName), value));

      if (!value) {
        fragment = null;
      } else if (isFragment(value)) {
        // A fragment instance was given, so just replace the existing value
        fragment = setFragmentOwner(value, record, key);
      } else if (!fragment) {
        // A property hash was given but the property was null, so create a new
        // fragment with the data
        fragment = createFragment(store, declaredModelName, record, key, options, value);
      } else {
        // The fragment already exists and a property hash is given, so just set
        // its values and let the state machine take care of the dirtiness
        setProperties(fragment, value);

        return fragment;
      }

      if (this.fragments[key] !== fragment) {
        fragmentDidDirty(record, key, fragment);
      } else {
        fragmentDidReset(record, key);
      }

    }


    setupFragmentArray(key, options, createArray, record) {
      debugger
      let data = this.getFragmentWithDefault(key, options, 'array');
      let fragments = this.fragments[key] || null;

      // If we already have a processed fragment in _data and our current fragment is
      // null simply reuse the one from data. We can be in this state after a rollback
      // for example
      if (data instanceof StatefulArray && !fragments) {
        fragments = data;
      // Create a fragment array and initialize with data
      } else if (data && data !== fragments) {
        fragments || (fragments = createArray(record, key));
        this.fragmentData[key] = fragments;
        fragments.setupData(data);
      } else {
        // Handle the adapter setting the fragment array to null
        fragments = data;
      }

      return fragments;
    }
  
    getFragment(key) {

    }
    // PUBLIC API
  
    setupFragmentData(data, calculateChange) {
      let keys = [];
      if (data.attributes) {
        this.fragmentNames.forEach((name) => {
          if (calculateChange && this.fragments[name] !== undefined) {
            keys.push(name);
          }
          if (name in data.attributes) {
            this.fragmentData[name] = data.attributes[name];
            delete data.attributes[name];
          }
        });
      }
      return keys;
    }

    setupData(tempData, calculateChange) {
      // TODO IGOR REMOVE THIS HACK
      let data = copy(tempData, true);
      let keys = this.setupFragmentData(data, calculateChange);
      return keys.concat(super.setupData(data, calculateChange));
    }
  
    adapterWillCommit() {
    }
  
    hasChangedAttributes() {
      return this.__attributes !== null && Object.keys(this.__attributes).length > 0;
    }
  
    // TODO, Maybe can model as destroying model data?
    resetRecord() {
      this.__attributes = null;
      this.__inFlightAttributes = null;
      this._data = null;
    }
  
    /*
      Returns an object, whose keys are changed properties, and value is an
      [oldProp, newProp] array.
  
      @method changedAttributes
      @private
    */
    changedAttributes() {
      return super.changedAttributes();
      /*
      let oldData = this._data;
      let currentData = this._attributes;
      let inFlightData = this._inFlightAttributes;
      let newData = emberAssign(copy(inFlightData), currentData);
      let diffData = Object.create(null);
      let newDataKeys = Object.keys(newData);
  
      for (let i = 0, length = newDataKeys.length; i < length; i++) {
        let key = newDataKeys[i];
        diffData[key] = [oldData[key], newData[key]];
      }
  
      return diffData;
      */
    }
  
    rollbackAttributes() {
      let keys = [];
      for (let key in this.fragments) {
        if (this.fragments[key]) {
          this.fragments[key].rollbackAttributes();
          keys.push(key);
        } else {
          keys.push(key);
          delete this.fragments[key];
        }
      }
      return keys.concat(super.rollbackAttributes());
    }
  
    adapterDidCommit(data) {
      let fragment, attributes;
      if (data && data.attributes) {
        attributes = data.attributes;
      } else {
        attributes = Object.create(null);
      }
      for (let key in this.fragments) {
        fragment = this.fragments[key];
        if (fragment) {
          fragment._adapterDidCommit(attributes[key]);
        }
      }
      // TODO IGOR this seems sketch, not reason we shouldn't setup data here
      // this.setupFragmentData(data);
      return super.adapterDidCommit(data);
    }

    saveWasRejected() {
      return super.saveWasRejected();
      /*
      let keys = Object.keys(this._inFlightAttributes);
      if (keys.length > 0) {
        let attrs = this._attributes;
        for (let i=0; i < keys.length; i++) {
          if (attrs[keys[i]] === undefined) {
            attrs[keys[i]] = this._inFlightAttributes[keys[i]];
          }
        }
      }
      this._inFlightAttributes = null;
      */
    }

    setAttr(key, value) {
      return super.setAttr(key, value);
      /*
      let oldValue = this.getAttr(key);
      let originalValue;
  
      if (value !== oldValue) {
        // Add the new value to the changed attributes hash; it will get deleted by
        // the 'didSetProperty' handler if it is no different from the original value
        this._attributes[key] = value;
  
        if (key in this._inFlightAttributes) {
          originalValue = this._inFlightAttributes[key];
        } else {
          originalValue = this._data[key];
        }
        // If we went back to our original value, we shouldn't keep the attribute around anymore
        if (value === originalValue) {
          delete this._attributes[key];
        }
        // TODO IGOR DAVID whats up with the send
        this.internalModel.send('didSetProperty', {
          name: key,
          oldValue: oldValue,
          originalValue: originalValue,
          value: value
        });
      }
      */
    }
  
    getAttr(key) {
      return super.getAttr(key);
      /*
      if (key in this._attributes) {
        return this._attributes[key];
      } else if (key in this._inFlightAttributes) {
        return this._inFlightAttributes[key];
      } else {
        return this._data[key];
      }
      */
    }
  
    hasAttr(key) {
      return super.hasAttr(key);
      /*
      return key in this._attributes ||
            key in this._inFlightAttributes ||
            key in this._data;
            */
    }
  
  
    /*
    // TODO IGOR AND DAVID REFACTOR THIS
    didCreateLocally(properties) {
      // TODO @runspired this should also be coalesced into some form of internalModel.setState()
      this.internalModel.eachRelationship((key, descriptor) => {
        if (properties[key] !== undefined) {
          this._relationships.get(key).setHasData(true);
        }
      });
    }
  
  
    */

}

// The default value of a fragment is either an array or an object,
// which should automatically get deep copied
function getFragmentDefaultValue(options, type) {
  let value;

  if (typeof options.defaultValue === 'function') {
    value = options.defaultValue();
  } else if ('defaultValue' in options) {
    value = options.defaultValue;
  } else if (type === 'array') {
    value = [];
  } else {
    return null;
  }

  assert(`The fragment's default value must be an ${type}`, (typeOf(value) == type) || (value === null));

  // Create a deep copy of the resulting value to avoid shared reference errors
  return copy(value, true);
}
