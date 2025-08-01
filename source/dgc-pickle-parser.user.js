// ==UserScript==
// @name        DesmosPickler
// @namespace   slidav.Desmos
// @version     1.2.4
// @author      SlimRunner (David Flores)
// @description Serializes a Desmos graph into a PNG image
// @grant       none
// @match       https://*.desmos.com/calculator*
// @match       https://*.desmos.com/geometry*
// @match       https://*.desmos.com/3d*
// @downloadURL https://github.com/SlimRunner/desmos-pickler/raw/master/source/dgc-pickle-parser.user.js
// @updateURL   https://github.com/SlimRunner/desmos-pickler/raw/master/source/dgc-pickle-parser.user.js
// ==/UserScript==

/*jshint esversion: 6 */

(function() {
	'use strict';
	var Calc, CTag;
	
	defineScript();
	
	/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
	// Global data structures & objects
	
	const FILE_SIGNATURE = 'PCKL';
	const QRY_MAIN_CONT = '#graph-container .dcg-container';
	var ctrs;

	const CALC_TYPES = Object.freeze({
		invalid: -1,
		calc_2d: 0,
		geometry: 1,
		calc_3d: 2
	});
	
	// creates an error with custom name
	class CustomError extends Error {
		/* Source
		* https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error
		*/
		constructor(name, ...params) {
			// Pass remaining arguments (including vendor specific ones) to parent constructor
			super(...params);

			// Maintains proper stack trace for where our error was thrown (only available on V8)
			if (Error.captureStackTrace) {
				Error.captureStackTrace(this, CustomError);
			}
				
			this.name = name;
		}
	}
	
	/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
	// GUI Management - Main
	
	// Initializes the script GUI
	function initGUI() {
		let graphContainer = document.querySelector(QRY_MAIN_CONT);
		if (graphContainer == null) {
			throw new CustomError(
				'Page Error',
				'Graph containter was not found'
			);
		}
		
		insertNodes(document.head, {
			group : [{
				tag : 'style',
				id : 'pickle-script-stylesheet',
				attributes : [
					{name: 'type', value: 'text/css'}
				],
				nodeContent :
				`.dpk-sli-prop-menu {
					display: flex;
					gap: 5px;
					
					position: fixed;
					transition: opacity 0.1s ease-out;
					
					padding: 0px;
				}
				
				.dpk-sli-menu-button {
					background: #ededed;
					padding: 5px;
					width: 37px;
					height: 37px;
					pointer-events: initial;
				}
				
				.dpk-sli-dcg-icon-align {
					text-align: center;
					line-height: 2em;
				}
				
				.dpk-sli-file-label input[type="file"] {
					display: none;
				}`
			}]
		})
		
		// https://stackoverflow.com/a/25825731
		ctrs = insertNodes(graphContainer, {
			group: [{
				tag: 'div',
				varName: 'drawerMenu',
				classes : [
					'dpk-sli-prop-menu'
				],
				group: [{
					tag: 'label',
					attributes: [
						{name: 'title', value: 'Load pickle'}
					],
					classes : [
						'dpk-sli-menu-button',
						'dpk-sli-dcg-icon-align',
						'dpk-sli-file-label',
						'dcg-btn-flat-gray'
					],
					group : [{
						tag: 'input',
						varName: 'loadButton',
						attributes: [
							{name: 'type', value: 'file'},
							{name: 'accept', value: 'image/png'}
						]
					},{
						tag : 'i',
						classes : [
							'dcg-icon-export'
						]
					}]
				}, {
					tag: 'div',
					varName: 'saveButton',
					attributes: [
						{name: 'title', value: 'Save pickle'}
					],
					classes : [
						'dpk-sli-menu-button',
						'dpk-sli-dcg-icon-align',
						'dcg-btn-flat-gray'
					],
					group : [{
						tag : 'i',
						classes : [
							'dcg-icon-download'
						]
					}]
				}]
			}]
		});
		
		let pillSizeObs = new ResizeObserver((ents) => {
			resizeDrawer(ents[0].target);
		});
		
		const pillbox = document.querySelector('.dcg-overgraph-pillbox-elements');

		if (pillbox) {
			ctrs.drawerMenu.style.position = "absolute";
			pillbox.insertBefore(ctrs.drawerMenu, null);
			pillSizeObs.observe(pillbox);
			resizeDrawer(pillbox);
		} else {
			resizeDrawer(null);
		}
	}
	
	// moves the GUI buttons in sync with Desmos GUI
	function resizeDrawer(pillbox) {
		if (pillbox != null) {
			const {width} = pillbox.getBoundingClientRect();
			ctrs.drawerMenu.style.right = `${5 + width}px`;
			ctrs.drawerMenu.style.top = `${0}px`;
		} else {
			ctrs.drawerMenu.style.right = `${-5}px`;
			ctrs.drawerMenu.style.top = `${0}px`;
		}
	}
	
	// initializes the event handlers of the GUI
	function loadHandlers() {
		ctrs.loadButton.addEventListener('change', (evt) => {
			const displayName = evt.target.files[0].name.replace(/.png$/i, '');
			let fRead = new FileReader();
			fRead.addEventListener('load', () => {
				let tImg = document.createElement('img');
				tImg.addEventListener('load', () => {
					let canv = document.createElement('canvas');
					canv.setAttribute('width', tImg.width + 'px');
					canv.setAttribute('height', tImg.height + 'px');
					let ctx = canv.getContext('2d');
					ctx.drawImage(tImg, 0, 0);
					setTimeout(() => {
						setGraphName(displayName);
						deserializeImage(ctx.getImageData(0, 0, tImg.width, tImg.height));
					}, 0);
				}, {once: true});
				tImg.src = fRead.result;
			}, {once: true});
			
			fRead.readAsDataURL(evt.target.files[0]);
		});
		
		ctrs.saveButton.addEventListener('click', (e) => {
			buildSerial(
				JSON.stringify(Calc.getState())
			)
		});
	}
	
	/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
	// Encoding & Data Parsing
	
	// validates image and loads graph
	function deserializeImage(imgData) {
		let fBuffer = imgData.data
			.filter((e,i) => i % 4 != 3)
			.map((e,i) => (i < 8? e: 255 - e));
		let fileSig = fBuffer.slice(0, 4);
		if (String.fromCharCode.apply(null, fileSig) === FILE_SIGNATURE) {
			let size = parseDWord(fBuffer.slice(4, 8));
			let pixelData = fBuffer.slice(8, 8 + size);
			let jsonStr = new TextDecoder().decode(pixelData);
			let json = JSON.parse(jsonStr);

			if (convertCalculator(json)) {
				Calc.setState(json);
				loadScripts(Calc);
			}
		}
	}

	// converts between calculators for cross compatibility
	function convertCalculator(json) {
		const srcType = categorizeCalcType(json.graph?.product ?? 'calculator')
		const destType = categorizeCalcType(CTag);
		if (srcType === destType) {
			return true;
		}
		if (srcType === CALC_TYPES.geometry) {
			json.expressions.list = json.expressions.list.filter(
				e => e.id !== '**dcg_geo_folder**'
			);
		}
		if (
			!confirm(
				'The source and destination graph types do not match. ' + 
				'This may cause errors. ' + 
				'Do you want to proceed?'
			)
		) {
			return false;
		}
		switch (destType) {
			case CALC_TYPES.calc_2d:
				json.graph = {
					"viewport": {
						"xmin": -10,
						"ymin": -10.86281070745698,
						"xmax": 10,
						"ymax": 10.86281070745698
					}
				};
				break;
			case CALC_TYPES.geometry:
				json.graph = {
					"viewport": {
						"xmin": -10,
						"ymin": -10.289196940726576,
						"xmax": 10,
						"ymax": 10.289196940726576
					},
					"showGrid": false,
					"showXAxis": false,
					"showYAxis": false,
					"degreeMode": true,
					"product": "geometry-calculator"
				}
				json.expressions.list.unshift(
					{
						"type": "folder",
						"id": "**dcg_geo_folder**",
						"title": "geometry",
						"secret": true
					}
				);
				break;
			case CALC_TYPES.calc_3d:
				json.graph = {
					"viewport": {
						"xmin": -5,
						"ymin": -5,
						"zmin": -5,
						"xmax": 5,
						"ymax": 5,
						"zmax": 5
					},
					"threeDMode": true,
					"product": "graphing-3d"
				};
				break;
			case CALC_TYPES.invalid:
				alert('Error: graph types are not valid, graph was not loaded.');
				throw TypeError('supported graphs are calculator, geometry, and 3d.');
			default:
				alert('Fatal Error: the graph could not be loaded.');
				throw TypeError('graph could not be loaded due to an unknown error.');
		}

		return true;
	}

	// returns a safe "enum" for the calculator type
	function categorizeCalcType(tag) {
		if (tag === 'calculator') {
			return CALC_TYPES.calc_2d;
		} else if (tag === 'geometry-calculator' || tag === 'geometry') {
			return CALC_TYPES.geometry;
		} else if (tag === 'graphing-3d' || tag === '3d') {
			return CALC_TYPES.calc_3d;
		} else {
			return CALC_TYPES.invalid;
		}
	}
	
	// returns prepared data as a buffer to be turned into image
	function buildSerial(jsonData) {
		// https://stackoverflow.com/a/41180394
		let ascii = Array.from(
			new TextEncoder('utf-8').encode(jsonData)
		).map(e => 255 - e);
		let header = [...FILE_SIGNATURE].map(e => e.charCodeAt(0));
		header.push(...getDWord(ascii.length));
		let rawSize = Math.ceil((ascii.length + header.length) / 3);
		let adjSize = getMinimalSquare(rawSize);
		let padding = Array(adjSize.x * adjSize.y - rawSize);
		let imgBuffer = header.concat(ascii, padding);
		saveImage(imgBuffer, adjSize.x, adjSize.y);
	}
	
	// grabs serialized data and plots it in a image to be saved
	function saveImage(serial, width, height) {
		let size = width * height;
		let canv = document.createElement('canvas');
		canv.setAttribute('width', `${width}px`);
		canv.setAttribute('height', `${height}px`);
		let ctx = canv.getContext('2d');
		let imageData = ctx.createImageData(width, height);
		serial.forEach((byte, i) => {
			imageData.data[i + (i / 3 | 0)] = byte;
		});
		for (var i = 3; i < imageData.data.length; i += 4) {
			imageData.data[i] = 0xff;
		}
		ctx.putImageData(imageData, 0, 0);
		download(canv.toDataURL('image/png'), getGraphName());
	}
	
	/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
	// Helper functions
	
	// creates a tree of elements and appends them into parentNode. Returns an object containing all named nodes
	function insertNodes(parentNode, nodeTree) {
		function recurseTree (parent, nextTree, nodeAdder) {
			for (let branch of nextTree.group) {
				if (!branch.hasOwnProperty('tag')) {
					throw new CustomError('Parameter Error', 'Tag type is not defined');
				}
				let child = document.createElement(branch.tag);
				parent.appendChild(child);
				
				if (branch.hasOwnProperty('varName')) {
					nodeAdder[branch.varName] = child;
				}
				if (branch.hasOwnProperty('id')) {
					child.setAttribute('id', branch.id);
				}
				if (branch.hasOwnProperty('classes')) {
					child.classList.add(...branch.classes);
				}
				if (branch.hasOwnProperty('styles')) {
					Object.assign(child.style, branch.styles);
				}
				if (branch.hasOwnProperty('attributes')) {
					branch.attributes.forEach(elem => {
						child.setAttribute(elem.name, elem.value);
					});
				}
				if (branch.hasOwnProperty('nodeContent')) {
					child.innerHTML = branch.nodeContent;
				}
				if (branch.hasOwnProperty('group')) {
					recurseTree(child, branch, nodeAdder); // they grow so fast :')
				}
			}
			return nodeAdder;
		}
		return recurseTree(parentNode, nodeTree, []);
	}
	
	// Function to download data to a file
	function download(url, filename) {
		if (window.navigator.msSaveOrOpenBlob) { // IE10+
			window.navigator.msSaveOrOpenBlob(url, filename);
		} else { // Others
			var a = document.createElement("a");
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			setTimeout(function() {
				document.body.removeChild(a);
				window.URL.revokeObjectURL(url);  
			}, 0); 
		}
	}
	
	// returns the current name of the graph
	function getGraphName() {
		const gc = Calc?._calc?.globalHotkeys?.shellController?.graphsController;
		if (gc != null && gc.isCurrentGraphTitled() && gc?.getCurrentGraphTitle() != null) {
			return gc.getCurrentGraphTitle();
		} else {
			return "undefined";
		}
	}

	function setGraphName(graphTitle) {
		Calc
			._calc
			.globalHotkeys
			.shellController
			.graphsController
			.currentGraph
			.title = graphTitle;
	}
	
	// returns an array of four bytes in the endianness specified
	function getDWord(value, littleEnd = true) {
		let R1, R2, R3, R4;
		if (littleEnd) {
			R1 = value >> 0x18;
			R2 = value >> 0x10 & 0xff;
			R3 = value >>  0x8 & 0xff;
			R4 = value         & 0xff;
		} else {
			R1 = value         & 0xff;
			R2 = value >>  0x8 & 0xff;
			R3 = value >> 0x10 & 0xff;
			R4 = value >> 0x18;
		}
		return [R1, R2, R3, R4];
	}
	
	// returns an integer whose value represent a byte d-word
	function parseDWord(value, littleEnd = true) {
		if (littleEnd) {
			return value.reduce((a, e, i) => a << 8 | e);
		} else {
			return value.reverse().reduce((a, e, i) => a << 8 | e);
		}
	}
	
	// gets the nearest square size with independent axis of given number
	function getMinimalSquare(cellCount) {
		return {
			x: Math.ceil(Math.sqrt(cellCount)),
			y: Math.round(Math.sqrt(cellCount))
		};
	}
	
	// DesmosLoader script by Cyan
	function loadScripts(Calc) {
		let exprs = Array.from(Calc.getState().expressions.list);
		let first = exprs[0];
		if (first.type === 'text') {
			let text = first.text;
			let textsplit = text.split('\n').filter(
				line => line.startsWith('include ')
			).map(line => line.slice(8));
			let folders = exprs.filter((expr) => expr.type === 'folder');
			if (
				textsplit.length > 0 &&
				confirm(`This graph contains a script.\n\nDo you want to load the script?`)
			) {
				Calc.observe('expressionAnalysis.scriptRun', () => {
					Calc.unobserve('expressionAnalysis.scriptRun');
					for (const line of textsplit) {
						let folder = folders.find(folder => folder.title === line);
						let matchfolderid = folder ? folder.id : '';
						let texts = exprs.filter(expr => (expr.type == 'text' && expr.folderId === matchfolderid));
						for (const code of texts) {
							window.eval(code.text);
						}
					}
				});
			}
		}
	}
	
	/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
	// User-Script Initialization
	
	// defines an object that is shared among my scripts 
	function defineScript() {
		if (window.SLM === undefined) {
			console.log(
				'scripts by\n' +
				' _____ _ _          ______                            \n' + 
				'/  ___| (_)         | ___ \\                           \n' + 
				'\\ \`--.| |_ _ __ ___ | |_/ /   _ _ __  _ __   ___ _ __ \n' + 
				' \`--. \\ | | \'_ \` _ \\|    / | | | \'_ \\| \'_ \\ / _ \\ \'__|\n' + 
				'/\\__/ / | | | | | | | |\\ \\ |_| | | | | | | |  __/ |   \n' + 
				'\\____/|_|_|_| |_| |_\\_| \\_\\__,_|_| |_|_| |_|\\___|_|   \n'
			);
			
			window.SLM = Object.assign({}, {
				messages: [],
				scripts: [GM_info.script.name],
				
				printMsgQueue: function() {
					while (this.printMessage()) { }
				},
				
				printMessage: function() {
					if (this.messages.length === 0) return false;
					let msg = this.messages.shift();
					console[msg.type](...msg.args);
					return this.messages.length !== 0;
				},
				
				pushMessage: function(type, ...msgArgs) {
					this.messages.push({
						type: type,
						args: msgArgs
					});
				}
			});
			
			Object.defineProperties(window.SLM, {
				MESSAGE_DELAY : {
					value: 500,
					writable: false,
					enumerable: true,
					configurable: true
				},
				ATTEMPTS_LIMIT : {
					value: 50,
					writable: false,
					enumerable: true,
					configurable: true
				},
				ATTEMPTS_DELAY : {
					value: 200,
					writable: false,
					enumerable: true,
					configurable: true
				}
			});
		} else {
			window.SLM.scripts.push(GM_info.script.name);
		}
	}
	
	// checks if calc and desmos are defined
	function isCalcReady() {
		if (
			window.Desmos !== undefined &&
			window.Calc !== undefined
		) {
			Calc = window.Calc;
			return true;
		} else {
			return false;
		}
	}
	
	// iife that checks if Desmos has finished loading (10 attempts)
	(function loadCheck () {
		const SLM = window.SLM;
		
		if (loadCheck.attempts === undefined) {
			loadCheck.attempts = 0;
		} else {
			loadCheck.attempts++;
		}
		
		if (!isCalcReady()) {
			if (loadCheck.attempts < SLM.ATTEMPTS_LIMIT) {
				window.setTimeout(loadCheck, SLM.ATTEMPTS_DELAY);
			} else {
				SLM.pushMessage('warn', '%s aborted loading', GM_info.script.name);
				setTimeout(() => {
					SLM.printMsgQueue();
				}, SLM.MESSAGE_DELAY);
			}
			
		} else {
			
			try {
				const tagRx = /(?<=\.com\/)\w+/;
				CTag = tagRx.exec(document.URL)[0];
				
				initGUI();
				loadHandlers();
				
				SLM.pushMessage('log', '%s loaded properly ✔️', GM_info.script.name);
			} catch (ex) {
				SLM.pushMessage('error', `${ex.name}: ${ex.message}`);
				SLM.pushMessage('warn', 'An error was encountered while loading');
			} finally {
				setTimeout(() => {
					SLM.printMsgQueue();
				}, SLM.MESSAGE_DELAY);
			}
			
		}
	}());
}());
